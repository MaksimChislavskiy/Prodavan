import uuid

from rest_framework import status
from rest_framework.response import Response

from deals.models import Deal

from .models import Task
from .views import (
    TaskDashboardView,
    TaskDetailView,
    TaskHistoryView,
    TasksView,
    validation_response,
)


LIMIT_ERROR = 'Значение должно быть от 1 до 100.'
RELATION_ERROR = {
    'error': {
        'code': 'RELATION_MISMATCH',
        'message': 'Выбранная сделка не связана с указанным контактом.',
    },
}


def _validate_optional_limit(request):
    value = request.query_params.get('limit')
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return validation_response({'limit': [LIMIT_ERROR]})
    if not 1 <= parsed <= 100:
        return validation_response({'limit': [LIMIT_ERROR]})
    return None


def _parse_uuid_or_none(value):
    if value is None:
        return None
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return Ellipsis


class TaskListCreateView(TasksView):
    """Public task collection contract with precise parameter validation."""

    def get(self, request):
        error_response = _validate_optional_limit(request)
        if error_response is not None:
            return error_response
        return super().get(request)

    def post(self, request):
        idempotency_key = request.headers.get('Idempotency-Key', '').strip()
        if idempotency_key:
            try:
                parsed_key = uuid.UUID(idempotency_key)
            except (ValueError, AttributeError):
                return validation_response({
                    'Idempotency-Key': ['Заголовок должен содержать UUID.'],
                })
            if str(parsed_key) != idempotency_key.lower():
                return validation_response({
                    'Idempotency-Key': ['Заголовок должен содержать UUID.'],
                })
        return super().post(request)


class TaskDashboardContractView(TaskDashboardView):
    """Dashboard returns the full Task DTO, not the compact kanban DTO."""

    def get(self, request):
        response = super().get(request)
        tasks = response.data.get('tasks', [])
        if not tasks:
            return response

        task_ids = [item['id'] for item in tasks]
        details = {
            str(task_id): (description, comment)
            for task_id, description, comment in Task.objects.filter(
                workspace=request.user.workspace,
                is_deleted=False,
                id__in=task_ids,
            ).values_list('id', 'description', 'comment')
        }
        for item in tasks:
            description, comment = details.get(item['id'], (None, None))
            item['description'] = description
            item['comment'] = comment
        return response


class TaskDetailContractView(TaskDetailView):
    """Apply the PATCH relation rule exactly as specified in section 10.9.6."""

    def patch(self, request, task_id):
        if 'contact_id' not in request.data:
            return super().patch(request, task_id)

        task = Task.objects.filter(
            id=task_id,
            workspace=request.user.workspace,
            is_deleted=False,
        ).only('deal_id').first()
        if task is None:
            return super().patch(request, task_id)

        raw_deal_id = request.data.get('deal_id', task.deal_id)
        if raw_deal_id is None:
            return super().patch(request, task_id)

        contact_id = _parse_uuid_or_none(request.data.get('contact_id'))
        deal_id = _parse_uuid_or_none(raw_deal_id)
        if contact_id is Ellipsis or deal_id is Ellipsis:
            return super().patch(request, task_id)

        deal = Deal.objects.filter(
            id=deal_id,
            workspace=request.user.workspace,
            is_deleted=False,
        ).only('contact_id').first()
        if deal is None:
            return super().patch(request, task_id)

        if deal.contact_id != contact_id:
            return Response(RELATION_ERROR, status=status.HTTP_400_BAD_REQUEST)

        return super().patch(request, task_id)


class TaskHistoryContractView(TaskHistoryView):
    def get(self, request, task_id):
        error_response = _validate_optional_limit(request)
        if error_response is not None:
            return error_response
        return super().get(request, task_id)
