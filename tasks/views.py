from django.db.models import Case, F, IntegerField, Q, Value, When
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .cursors import (
    decode_history_cursor,
    decode_task_cursor,
    encode_history_cursor,
    encode_task_cursor,
)
from .dates import local_day_bounds
from .models import DueDateType, Task, TaskHistory, TaskStatus
from .serializers import (
    TaskBulkDeleteSerializer,
    TaskCreateSerializer,
    TaskDetailSerializer,
    TaskHistorySerializer,
    TaskListSerializer,
    TaskStatusSerializer,
    TaskUpdateSerializer,
)
from .services import (
    TaskServiceError,
    bulk_delete_tasks,
    create_task,
    delete_task,
    request_audit_context,
    update_task,
    update_task_status,
)


TASK_ORDERING = (F('due_date').asc(nulls_last=True), '-created_at', '-id')


def validation_response(errors):
    flattened = {}
    for field, messages in errors.items():
        if isinstance(messages, (list, tuple)) and messages:
            first = messages[0]
            flattened[field] = str(first)
        else:
            flattened[field] = str(messages)
    return Response(
        {'message': 'Validation failed', 'errors': flattened},
        status=status.HTTP_400_BAD_REQUEST,
    )


def parse_limit(value, default):
    try:
        result = default if value is None else int(value)
    except (TypeError, ValueError):
        raise ValueError from None
    if not 1 <= result <= 100:
        raise ValueError
    return result


def task_page(queryset, *, limit, cursor):
    if cursor:
        due_date, created_at, object_id = decode_task_cursor(cursor)
        if due_date is None:
            queryset = queryset.filter(
                due_date__isnull=True,
            ).filter(
                Q(created_at__lt=created_at)
                | Q(created_at=created_at, id__lt=object_id),
            )
        else:
            queryset = queryset.filter(
                Q(due_date__gt=due_date)
                | Q(due_date__isnull=True)
                | Q(
                    due_date=due_date,
                    created_at__lt=created_at,
                )
                | Q(
                    due_date=due_date,
                    created_at=created_at,
                    id__lt=object_id,
                ),
            )
    rows = list(queryset.order_by(*TASK_ORDERING)[:limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_task_cursor(rows[-1]) if has_more and rows else None
    return rows, next_cursor, has_more


def base_tasks(request):
    return Task.objects.filter(
        workspace=request.user.workspace,
        is_deleted=False,
    ).select_related('workspace', 'contact', 'deal')


class TaskKanbanView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            limit = parse_limit(request.query_params.get('limit'), 50)
        except ValueError:
            return validation_response({'limit': ['Значение должно быть от 1 до 100.']})
        result = {}
        for task_status in TaskStatus.values:
            queryset = base_tasks(request).filter(status=task_status)
            count = queryset.count()
            rows, next_cursor, _ = task_page(queryset, limit=limit, cursor=None)
            result[task_status] = {
                'tasks': TaskListSerializer(rows, many=True).data,
                'count': count,
                'next_cursor': next_cursor,
            }
        return Response(result)


class TasksView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        task_status = request.query_params.get('status')
        if task_status not in TaskStatus.values:
            return validation_response({
                'status': ['Допустимы значения new, in_progress, done.'],
            })
        try:
            limit = parse_limit(request.query_params.get('limit'), 50)
            rows, next_cursor, has_more = task_page(
                base_tasks(request).filter(status=task_status),
                limit=limit,
                cursor=request.query_params.get('cursor'),
            )
        except ValueError:
            return validation_response({'cursor': ['Некорректные параметры пагинации.']})
        return Response({
            'tasks': TaskListSerializer(rows, many=True).data,
            'next_cursor': next_cursor,
            'has_more': has_more,
        })

    def post(self, request):
        key = request.headers.get('Idempotency-Key', '').strip()
        if not key or len(key) > 255:
            return validation_response({
                'Idempotency-Key': ['Обязательный заголовок длиной до 255 символов.'],
            })
        serializer = TaskCreateSerializer(
            data=request.data,
            context={'workspace': request.user.workspace},
        )
        if not serializer.is_valid():
            return validation_response(serializer.errors)
        try:
            body, response_status = create_task(
                workspace=request.user.workspace,
                user=request.user,
                data=dict(serializer.validated_data),
                idempotency_key=key,
                audit_context=request_audit_context(request),
            )
        except TaskServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(body, status=response_status)


class TaskDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = request.user.workspace
        now = timezone.now()
        _, day_start, day_end = local_day_bounds(workspace, now=now)
        overdue = (
            Q(due_date_type=DueDateType.DATE, due_date__lt=day_start)
            | Q(due_date_type=DueDateType.DATETIME, due_date__lt=now)
        )
        queryset = base_tasks(request).filter(
            status__in=(TaskStatus.NEW, TaskStatus.IN_PROGRESS),
        ).filter(
            Q(due_date__lt=day_end)
            | Q(due_date__isnull=True)
            | Q(due_date_type=DueDateType.NONE),
        ).annotate(
            dashboard_priority=Case(
                When(overdue, then=Value(0)),
                When(due_date_type=DueDateType.DATETIME, then=Value(1)),
                When(due_date_type=DueDateType.DATE, then=Value(2)),
                default=Value(3),
                output_field=IntegerField(),
            ),
        ).order_by(
            'dashboard_priority',
            F('due_date').asc(nulls_last=True),
            '-created_at',
            '-id',
        )
        total_count = queryset.count()
        return Response({
            'tasks': TaskListSerializer(queryset[:10], many=True).data,
            'total_count': total_count,
        })


class TaskDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, task_id):
        task = base_tasks(request).filter(id=task_id).first()
        if task is None:
            return Response(
                {'error': {'code': 'TASK_NOT_FOUND', 'message': 'Задача не найдена.'}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(TaskDetailSerializer(task).data)

    def patch(self, request, task_id):
        serializer = TaskUpdateSerializer(
            data=request.data,
            context={'workspace': request.user.workspace},
        )
        if not serializer.is_valid():
            return validation_response(serializer.errors)
        data = dict(serializer.validated_data)
        submitted_version = data.pop('version')
        try:
            body = update_task(
                workspace=request.user.workspace,
                user=request.user,
                task_id=task_id,
                submitted_version=submitted_version,
                data=data,
                audit_context=request_audit_context(request),
            )
        except TaskServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(body)

    def delete(self, request, task_id):
        try:
            delete_task(
                workspace=request.user.workspace,
                user=request.user,
                task_id=task_id,
                audit_context=request_audit_context(request),
            )
        except TaskServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TaskStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, task_id):
        serializer = TaskStatusSerializer(data=request.data)
        if not serializer.is_valid():
            return validation_response(serializer.errors)
        try:
            body = update_task_status(
                workspace=request.user.workspace,
                user=request.user,
                task_id=task_id,
                submitted_version=serializer.validated_data['version'],
                new_status=serializer.validated_data['status'],
                audit_context=request_audit_context(request),
            )
        except TaskServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(body)


class TaskBulkDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = TaskBulkDeleteSerializer(data=request.data)
        if not serializer.is_valid():
            return validation_response(serializer.errors)
        result = bulk_delete_tasks(
            workspace=request.user.workspace,
            user=request.user,
            task_ids=serializer.validated_data['task_ids'],
            audit_context=request_audit_context(request),
        )
        return Response(result)


class TaskHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, task_id):
        if not Task.objects.filter(
            id=task_id,
            workspace=request.user.workspace,
        ).exists():
            return Response(
                {'error': {'code': 'TASK_NOT_FOUND', 'message': 'Задача не найдена.'}},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            limit = parse_limit(request.query_params.get('limit'), 20)
            queryset = TaskHistory.objects.filter(
                workspace=request.user.workspace,
                task_id=task_id,
            ).select_related('user').order_by('-created_at', '-id')
            cursor = request.query_params.get('cursor')
            if cursor:
                created_at, object_id = decode_history_cursor(cursor)
                queryset = queryset.filter(
                    Q(created_at__lt=created_at)
                    | Q(created_at=created_at, id__lt=object_id),
                )
            rows = list(queryset[:limit + 1])
        except ValueError:
            return validation_response({'cursor': ['Некорректные параметры пагинации.']})
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = encode_history_cursor(rows[-1]) if has_more and rows else None
        return Response({
            'items': TaskHistorySerializer(rows, many=True).data,
            'next_cursor': next_cursor,
        })
