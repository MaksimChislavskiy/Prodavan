import json
import re
import uuid

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import UserRole

from .models import Workspace
from .serializers import (
    WorkspaceSettingsSerializer,
    WorkspaceSettingsUpdateSerializer,
)
from .services import (
    WorkspaceServiceError,
    canonical_request_hash,
    update_workspace_settings,
)


MAX_SETTINGS_BODY_SIZE = 256 * 1024
KNOWN_ERROR_CODES = {
    'INVALID_TIMEZONE',
    'INVALID_INN',
    'INVALID_OGRN',
    'INVALID_KPP',
    'VALIDATION_ERROR',
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
        code = getattr(errors[0], 'code', 'VALIDATION_ERROR')
        code = code if code in KNOWN_ERROR_CODES else 'VALIDATION_ERROR'
        return code, str(errors[0])
    return 'VALIDATION_ERROR', 'Ошибка валидации.'


def _parse_if_match(value):
    if value is None:
        return None
    match = re.fullmatch(r'"?(\d+)"?', value.strip())
    if not match:
        raise ValueError
    return int(match.group(1))


class WorkspaceSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def _workspace_or_error(self, request):
        if request.user.role != UserRole.ADMIN:
            return None, _error(
                'PERMISSION_DENIED',
                'Недостаточно прав.',
                status.HTTP_403_FORBIDDEN,
            )
        workspace = Workspace.objects.filter(id=request.user.workspace_id).first()
        if workspace is None:
            return None, _error(
                'VALIDATION_ERROR',
                'Workspace не найден.',
                status.HTTP_404_NOT_FOUND,
            )
        return workspace, None

    def get(self, request):
        workspace, error_response = self._workspace_or_error(request)
        if error_response is not None:
            return error_response
        response = Response(
            WorkspaceSettingsSerializer(workspace).data,
            status=status.HTTP_200_OK,
        )
        response['ETag'] = f'"{workspace.version}"'
        return response

    def patch(self, request):
        workspace, error_response = self._workspace_or_error(request)
        if error_response is not None:
            return error_response

        try:
            content_length = int(request.META.get('CONTENT_LENGTH') or 0)
        except ValueError:
            content_length = 0
        if content_length > MAX_SETTINGS_BODY_SIZE:
            return _error(
                'VALIDATION_ERROR',
                'Размер запроса превышает 256 KB.',
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
        actual_body_size = len(
            json.dumps(request.data, ensure_ascii=False).encode('utf-8'),
        )
        if actual_body_size > MAX_SETTINGS_BODY_SIZE:
            return _error(
                'VALIDATION_ERROR',
                'Размер запроса превышает 256 KB.',
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        serializer = WorkspaceSettingsUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            code, message = _first_validation_error(
                serializer.errors,
            )
            return _error(code, message, status.HTTP_400_BAD_REQUEST)

        try:
            header_version = _parse_if_match(request.headers.get('If-Match'))
        except ValueError:
            return _error(
                'INVALID_VERSION_HEADER',
                'Некорректный заголовок If-Match.',
                status.HTTP_400_BAD_REQUEST,
            )
        body_version = serializer.validated_data['version']
        if header_version is not None and header_version != body_version:
            return _error(
                'INVALID_VERSION_HEADER',
                'Значения version и If-Match не совпадают.',
                status.HTTP_400_BAD_REQUEST,
            )

        raw_idempotency_key = request.headers.get('Idempotency-Key')
        try:
            idempotency_key = (
                uuid.UUID(raw_idempotency_key)
                if raw_idempotency_key
                else None
            )
        except ValueError:
            return _error(
                'VALIDATION_ERROR',
                'Idempotency-Key должен быть UUID.',
                status.HTTP_400_BAD_REQUEST,
            )

        try:
            response_body, etag, replayed = update_workspace_settings(
                workspace_id=workspace.id,
                user=request.user,
                validated_data=serializer.validated_data,
                request_hash=canonical_request_hash(request.data),
                idempotency_key=idempotency_key,
            )
        except WorkspaceServiceError as error:
            return Response(error.response_data, status=error.status_code)

        response = Response(response_body, status=status.HTTP_200_OK)
        response['ETag'] = etag
        if replayed:
            response['Idempotency-Replayed'] = 'true'
        return response
