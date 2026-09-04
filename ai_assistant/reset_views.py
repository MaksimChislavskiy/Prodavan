from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from workspaces.onboarding import request_audit_context

from .serializers import (
    AISettingsResetSerializer,
    AISettingsSerializer,
)
from .services import AISettingsServiceError, update_ai_settings
from .views import _admin_workspace_or_error, _error, _first_validation_error


class AISettingsResetView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        workspace, error_response = _admin_workspace_or_error(request)
        if error_response is not None:
            return error_response

        serializer = AISettingsResetSerializer(data=request.data)
        if not serializer.is_valid():
            return _error(
                'VALIDATION_ERROR',
                _first_validation_error(serializer.errors),
                status.HTTP_400_BAD_REQUEST,
                fields=serializer.errors,
            )

        try:
            settings_object = update_ai_settings(
                workspace_id=workspace.id,
                user=request.user,
                validated_data={
                    'version': serializer.validated_data['version'],
                    'instruction': '',
                    'autopilot_enabled': False,
                    'autopilot_mode': 'fallback',
                    'autopilot_delay': 5,
                },
                audit_context=request_audit_context(request),
            )
        except AISettingsServiceError as error:
            return Response(error.response_data, status=error.status_code)

        response = Response(
            AISettingsSerializer(settings_object).data,
            status=status.HTTP_200_OK,
        )
        response['ETag'] = f'"{settings_object.version}"'
        return response
