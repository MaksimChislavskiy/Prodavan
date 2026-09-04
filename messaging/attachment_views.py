from urllib.parse import quote

from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from workspaces.crypto import IntegrationSecretError, decrypt_integration_secret
from workspaces.models import IntegrationStatus, IntegrationType, WorkspaceIntegration
from workspaces.telegram import TelegramApiError, TelegramBotApiClient

from .attachment_tokens import read_attachment_token
from .models import Message


class MessageAttachmentView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, message_id):
        token_data = read_attachment_token(
            request.query_params.get('token', ''),
        )
        if token_data is None:
            return Response(
                {'error': 'invalid_attachment_token', 'message': 'Ссылка недействительна.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        signed_message_id, workspace_id = token_data
        if signed_message_id != str(message_id):
            return Response(
                {'error': 'invalid_attachment_token', 'message': 'Ссылка недействительна.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        message = Message.objects.select_related('chat').filter(
            id=message_id,
            chat__workspace_id=workspace_id,
            chat__is_deleted=False,
            is_deleted=False,
        ).first()
        if message is None or not message.attachment_external_id:
            return Response(
                {'error': 'attachment_not_found', 'message': 'Вложение не найдено.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        integration = WorkspaceIntegration.objects.filter(
            workspace_id=workspace_id,
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
        ).first()
        if integration is None or not integration.config:
            return Response(
                {
                    'error': 'telegram_not_connected',
                    'message': 'Telegram-интеграция не подключена.',
                },
                status=status.HTTP_409_CONFLICT,
            )

        try:
            token = decrypt_integration_secret(
                envelope=integration.config,
                workspace_id=workspace_id,
                integration_type=IntegrationType.TELEGRAM,
            )
            client = TelegramBotApiClient()
            file_info = client.get_file(
                token,
                file_id=message.attachment_external_id,
            )
            content = client.download_file(
                token,
                file_path=file_info['file_path'],
            )
        except (IntegrationSecretError, TelegramApiError):
            return Response(
                {
                    'error': 'attachment_unavailable',
                    'message': 'Не удалось получить вложение из Telegram.',
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        content_type = message.attachment_mime_type or 'application/octet-stream'
        response = HttpResponse(content, content_type=content_type)
        response['Content-Length'] = str(len(content))
        filename = message.attachment_name or 'attachment'
        response['Content-Disposition'] = (
            "inline; filename*=UTF-8''" + quote(filename, safe='')
        )
        return response
