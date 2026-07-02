from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import UserRole

from .serializers import TelegramConnectSerializer
from .telegram_services import (
    TelegramIntegrationError,
    connect_telegram,
    disconnect_telegram,
)
from .throttles import TelegramConnectWorkspaceThrottle


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
