from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import UserRole

from .models import TelegramWebhookLog
from .serializers import (
    TelegramConnectSerializer,
    TelegramWebhookLogSerializer,
)
from .telegram_services import (
    TelegramIntegrationError,
    connect_telegram,
    disconnect_telegram,
    get_telegram_settings,
    receive_telegram_webhook,
)
from .throttles import (
    TelegramConnectWorkspaceThrottle,
    TelegramWebhookThrottle,
)


def _permission_error():
    return Response(
        {
            'error': {
                'code': 'PERMISSION_DENIED',
                'message': 'Недостаточно прав.',
            },
        },
        status=status.HTTP_403_FORBIDDEN,
    )


class TelegramConnectView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [TelegramConnectWorkspaceThrottle]

    def post(self, request):
        if request.user.role != UserRole.ADMIN:
            return _permission_error()
        serializer = TelegramConnectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            integration = connect_telegram(
                workspace=request.user.workspace,
                user=request.user,
                bot_token=serializer.validated_data['bot_token'],
            )
        except TelegramIntegrationError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(
            {
                'message': 'Telegram-интеграция подключена',
                'integration': integration,
            },
            status=status.HTTP_200_OK,
        )


class TelegramDisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if request.user.role != UserRole.ADMIN:
            return _permission_error()
        try:
            integration = disconnect_telegram(
                workspace=request.user.workspace,
                user=request.user,
            )
        except TelegramIntegrationError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(
            {
                'message': 'Telegram-интеграция отключена',
                'integration': integration,
            },
            status=status.HTTP_200_OK,
        )


class TelegramSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role != UserRole.ADMIN:
            return _permission_error()
        return Response(
            {
                'integration': get_telegram_settings(
                    workspace=request.user.workspace,
                ),
            },
            status=status.HTTP_200_OK,
        )


class TelegramWebhookLogsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role != UserRole.ADMIN:
            return _permission_error()
        logs = TelegramWebhookLog.objects.filter(
            workspace=request.user.workspace,
        )[:50]
        return Response(
            {
                'results': TelegramWebhookLogSerializer(logs, many=True).data,
            },
            status=status.HTTP_200_OK,
        )


class TelegramWebhookView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [TelegramWebhookThrottle]

    def post(self, request, workspace_secret):
        try:
            receive_telegram_webhook(
                path_secret=workspace_secret,
                header_secret=request.headers.get(
                    'X-Telegram-Bot-Api-Secret-Token',
                    '',
                ),
                payload=request.data,
            )
        except TelegramIntegrationError as error:
            return Response(error.response_data, status=error.status_code)
        return Response({'ok': True}, status=status.HTTP_200_OK)
