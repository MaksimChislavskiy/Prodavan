import re

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import UserRole
from workspaces.models import Workspace

from .serializers import AISettingsSerializer, AISettingsUpdateSerializer
from .services import (
    AISettingsServiceError,
    get_ai_settings,
    update_ai_settings,
)


MAX_AI_SETTINGS_BODY_SIZE = 64 * 1024


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


class AISettingsView(APIView):
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
                'NOT_FOUND',
                'Workspace не найден.',
                status.HTTP_404_NOT_FOUND,
            )
        return workspace, None

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
