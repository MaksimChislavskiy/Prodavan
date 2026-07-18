import re

from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import UserRole
from workspaces.models import Workspace
from workspaces.models import OnboardingAuditEvent
from workspaces.onboarding import (
    record_onboarding_upload_event,
    request_audit_context,
)

from .cursors import InvalidCursor, decode_cursor, encode_cursor
from .knowledge import (
    KnowledgeServiceError,
    active_documents,
    create_knowledge_documents,
    delete_knowledge_document,
    get_active_document,
    retry_knowledge_document,
    storage_usage,
)
from .models import (
    AIAutomationAuditAction,
    AIAutomationAuditLog,
    AutomationActionType,
    KnowledgeDocumentStatus,
)
from .serializers import (
    AIAutomationAuditLogSerializer,
    AISettingsSerializer,
    AISettingsUpdateSerializer,
    KnowledgeDocumentSerializer,
)
from .throttles import KnowledgeUploadWorkspaceThrottle
from .services import (
    AISettingsServiceError,
    get_ai_settings,
    update_ai_settings,
)


MAX_AI_SETTINGS_BODY_SIZE = 64 * 1024


AUDIT_TYPE_FILTERS = {
    'contact': {
        'action_type__in': [
            AutomationActionType.CONTACT_CREATE,
            AutomationActionType.CONTACT_ENRICHMENT,
        ],
    },
    'deal': {
        'action_type__in': [
            AutomationActionType.DEAL_CREATE,
            AutomationActionType.DEAL_ENRICHMENT,
        ],
    },
    'task': {'action_type__in': [AutomationActionType.TASK_CREATE]},
    'insight': {'action_type__in': [AutomationActionType.INSIGHT]},
    'autopilot': {'action_type': AutomationActionType.AUTOPILOT_REPLY},
    'skipped': {'action': AIAutomationAuditAction.AI_DECISION_SKIPPED},
    'limit': {'action': AIAutomationAuditAction.AI_LIMIT_REACHED},
    'failed': {'action': AIAutomationAuditAction.AI_ACTION_FAILED},
}


def _error(code, message, http_status, **extra):
    data = {'error': {'code': code, 'message': message}}
    data.update(extra)
    return Response(data, status=http_status)


def _first_validation_error(errors):
    if isinstance(errors, dict):
        for key in errors:
            result = _first_validation_error(errors[key])
            if result:
                return result
    elif isinstance(errors, list) and errors:
        return str(errors[0])
    return 'Ошибка валидации.'


def _parse_if_match(value):
    if value is None:
        return None
    match = re.fullmatch(r'"?(\d+)"?', value.strip())
    if not match:
        raise ValueError
    return int(match.group(1))


def _admin_workspace_or_error(request):
    if request.user.role != UserRole.ADMIN:
        return None, _error(
            'PERMISSION_DENIED',
            'Недостаточно прав.',
            status.HTTP_403_FORBIDDEN,
        )
    workspace = Workspace.objects.filter(id=request.user.workspace_id).first()
    if workspace is None:
        return None, _error(
            'NOT_FOUND',
            'Workspace не найден.',
            status.HTTP_404_NOT_FOUND,
        )
    return workspace, None


def _positive_int(value, *, default, minimum, maximum):
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError from None
    if not minimum <= parsed <= maximum:
        raise ValueError
    return parsed


class AISettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def _workspace_or_error(self, request):
        return _admin_workspace_or_error(request)

    def get(self, request):
        workspace, error_response = self._workspace_or_error(request)
        if error_response is not None:
            return error_response
        settings_object = get_ai_settings(workspace)
        response = Response(
            AISettingsSerializer(settings_object).data,
            status=status.HTTP_200_OK,
        )
        response['ETag'] = f'"{settings_object.version}"'
        return response

    def patch(self, request):
        workspace, error_response = self._workspace_or_error(request)
        if error_response is not None:
            return error_response

        try:
            content_length = int(request.META.get('CONTENT_LENGTH') or 0)
        except ValueError:
            content_length = 0
        if content_length > MAX_AI_SETTINGS_BODY_SIZE:
            return _error(
                'PAYLOAD_TOO_LARGE',
                'Тело запроса слишком большое.',
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        serializer = AISettingsUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return _error(
                'VALIDATION_ERROR',
                _first_validation_error(serializer.errors),
                status.HTTP_400_BAD_REQUEST,
                fields=serializer.errors,
            )

        try:
            if_match = _parse_if_match(request.headers.get('If-Match'))
        except ValueError:
            return _error(
                'INVALID_VERSION_HEADER',
                'Некорректный заголовок If-Match.',
                status.HTTP_400_BAD_REQUEST,
            )
        if (
            if_match is not None
            and if_match != serializer.validated_data['version']
        ):
            return _error(
                'INVALID_VERSION_HEADER',
                'Версия в If-Match не совпадает с версией в запросе.',
                status.HTTP_400_BAD_REQUEST,
            )

        try:
            settings_object = update_ai_settings(
                workspace_id=workspace.id,
                user=request.user,
                validated_data=serializer.validated_data,
            )
        except AISettingsServiceError as error:
            return Response(error.response_data, status=error.status_code)

        response = Response(
            AISettingsSerializer(settings_object).data,
            status=status.HTTP_200_OK,
        )
        response['ETag'] = f'"{settings_object.version}"'
        return response


class AIAuditView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace, error_response = _admin_workspace_or_error(request)
        if error_response is not None:
            return error_response
        try:
            limit = _positive_int(
                request.query_params.get('limit'),
                default=20,
                minimum=1,
                maximum=100,
            )
        except ValueError:
            return _error(
                'VALIDATION_ERROR',
                'Некорректный параметр limit.',
                status.HTTP_400_BAD_REQUEST,
            )

        type_filter = request.query_params.get('type', '').strip()
        queryset = AIAutomationAuditLog.objects.select_related(
            'user',
            'chat',
            'message',
        ).filter(workspace=workspace)
        if type_filter:
            filters = AUDIT_TYPE_FILTERS.get(type_filter)
            if filters is None:
                return _error(
                    'VALIDATION_ERROR',
                    'Некорректный параметр type.',
                    status.HTTP_400_BAD_REQUEST,
                )
            queryset = queryset.filter(**filters)

        cursor = request.query_params.get('cursor')
        if cursor:
            try:
                created_at, object_id = decode_cursor(cursor, kind='ai_audit')
            except InvalidCursor:
                return _error(
                    'INVALID_CURSOR',
                    'Некорректный курсор.',
                    status.HTTP_400_BAD_REQUEST,
                )
            queryset = queryset.filter(
                Q(created_at__lt=created_at)
                | Q(created_at=created_at, id__lt=object_id),
            )

        logs = list(queryset.order_by('-created_at', '-id')[:limit + 1])
        page = logs[:limit]
        next_cursor = None
        if len(logs) > limit and page:
            last = page[-1]
            next_cursor = encode_cursor(
                kind='ai_audit',
                timestamp=last.created_at,
                object_id=last.id,
            )
        return Response(
            {
                'logs': AIAutomationAuditLogSerializer(page, many=True).data,
                'next_cursor': next_cursor,
                'has_more': next_cursor is not None,
            },
            status=status.HTTP_200_OK,
        )


class KnowledgeFilesView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [KnowledgeUploadWorkspaceThrottle]

    def get(self, request):
        workspace, error_response = _admin_workspace_or_error(request)
        if error_response is not None:
            return error_response
        try:
            page = _positive_int(
                request.query_params.get('page'),
                default=1,
                minimum=1,
                maximum=2_147_483_647,
            )
            page_size = _positive_int(
                request.query_params.get('page_size'),
                default=50,
                minimum=1,
                maximum=100,
            )
        except ValueError:
            return _error(
                'VALIDATION_ERROR',
                'Некорректные параметры пагинации.',
                status.HTTP_400_BAD_REQUEST,
            )

        search = request.query_params.get('search', '').strip()
        if len(search) > 255:
            return _error(
                'VALIDATION_ERROR',
                'Поисковый запрос не должен превышать 255 символов.',
                status.HTTP_400_BAD_REQUEST,
            )
        status_filter = request.query_params.get('status')
        if status_filter and status_filter not in KnowledgeDocumentStatus.values:
            return _error(
                'VALIDATION_ERROR',
                'Некорректный статус документа.',
                status.HTTP_400_BAD_REQUEST,
            )
        sort = request.query_params.get('sort', 'uploaded_at:desc')
        sort_map = {
            'uploaded_at:desc': ('-created_at', '-id'),
            'uploaded_at:asc': ('created_at', 'id'),
            'name:asc': ('original_name', 'id'),
            'name:desc': ('-original_name', '-id'),
            'size:asc': ('size_bytes', 'id'),
            'size:desc': ('-size_bytes', '-id'),
            'status:asc': ('status', 'id'),
            'status:desc': ('-status', '-id'),
        }
        if sort not in sort_map:
            return _error(
                'VALIDATION_ERROR',
                'Некорректный параметр сортировки.',
                status.HTTP_400_BAD_REQUEST,
            )

        queryset = active_documents(workspace)
        if search:
            queryset = queryset.filter(original_name__icontains=search)
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        queryset = queryset.order_by(*sort_map[sort])
        total = queryset.count()
        offset = (page - 1) * page_size
        documents = queryset[offset:offset + page_size]
        return Response(
            {
                'files': KnowledgeDocumentSerializer(documents, many=True).data,
                'total': total,
                'page': page,
                'page_size': page_size,
                'storage': storage_usage(workspace),
            },
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        workspace, error_response = _admin_workspace_or_error(request)
        if error_response is not None:
            return error_response
        uploaded_files = list(request.FILES.getlist('files'))
        uploaded_files.extend(request.FILES.getlist('file'))
        audit_context = request_audit_context(request)
        record_onboarding_upload_event(
            workspace_id=workspace.id,
            user_id=request.user.id,
            event=OnboardingAuditEvent.UPLOAD_STARTED,
            details={'files_count': len(uploaded_files)},
            **audit_context,
        )
        try:
            documents = create_knowledge_documents(
                workspace=workspace,
                user=request.user,
                uploaded_files=uploaded_files,
            )
        except KnowledgeServiceError as error:
            record_onboarding_upload_event(
                workspace_id=workspace.id,
                user_id=request.user.id,
                event=OnboardingAuditEvent.UPLOAD_FAILED,
                details={'error': error.code},
                **audit_context,
            )
            return Response(error.response_data, status=error.status_code)
        except Exception:
            record_onboarding_upload_event(
                workspace_id=workspace.id,
                user_id=request.user.id,
                event=OnboardingAuditEvent.UPLOAD_FAILED,
                details={'error': 'INTERNAL_ERROR'},
                **audit_context,
            )
            raise
        record_onboarding_upload_event(
            workspace_id=workspace.id,
            user_id=request.user.id,
            event=OnboardingAuditEvent.UPLOAD_SUCCESS,
            details={'files_count': len(documents)},
            **audit_context,
        )
        return Response(
            {
                'files': KnowledgeDocumentSerializer(documents, many=True).data,
                'accepted': len(documents),
            },
            status=status.HTTP_202_ACCEPTED,
        )


class KnowledgeFileDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, document_id):
        workspace, error_response = _admin_workspace_or_error(request)
        if error_response is not None:
            return error_response
        document = get_active_document(
            workspace=workspace,
            document_id=document_id,
        )
        if document is None:
            return _error(
                'DOCUMENT_NOT_FOUND',
                'Документ не найден.',
                status.HTTP_404_NOT_FOUND,
            )
        return Response(KnowledgeDocumentSerializer(document).data)

    def delete(self, request, document_id):
        workspace, error_response = _admin_workspace_or_error(request)
        if error_response is not None:
            return error_response
        try:
            delete_knowledge_document(
                workspace=workspace,
                user=request.user,
                document_id=document_id,
            )
        except KnowledgeServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(status=status.HTTP_204_NO_CONTENT)


class KnowledgeFileRetryView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, document_id):
        workspace, error_response = _admin_workspace_or_error(request)
        if error_response is not None:
            return error_response
        try:
            document = retry_knowledge_document(
                workspace=workspace,
                user=request.user,
                document_id=document_id,
            )
        except KnowledgeServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(
            KnowledgeDocumentSerializer(document).data,
            status=status.HTTP_202_ACCEPTED,
        )
