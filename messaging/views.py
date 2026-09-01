from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Chat
from .outgoing import enqueue_outgoing_message
from .serializers import (
    MAX_ATTACHMENT_SIZE,
    ChatAutopilotSerializer,
    ChatSerializer,
    MessageSerializer,
    OutgoingMessageSerializer,
)
from .services import (
    ChatServiceError,
    delete_chat,
    get_chat,
    get_messages_page,
    mark_chat_read,
    request_audit_context,
    update_chat_autopilot,
)
from .throttles import ChatMessageThrottle


class MessageRateLimitExceeded(APIException):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_detail = {
        'error': 'rate_limit_exceeded',
        'message': 'Too many messages. Please slow down.',
    }
    default_code = 'rate_limit_exceeded'


class AttachmentTooLarge(APIException):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    default_detail = {
        'error': 'attachment_too_large',
        'message': 'Attachment must not exceed 20 MB.',
    }
    default_code = 'attachment_too_large'


def _positive_int(value, *, default, maximum):
    if value is None:
        return default
    try:
        value = int(value)
    except (TypeError, ValueError):
        return None
    return value if 1 <= value <= maximum else None


def _query_error(field, message):
    return Response(
        {'message': 'Validation failed', 'errors': {field: message}},
        status=status.HTTP_400_BAD_REQUEST,
    )


def _update_chat_settings(request, chat_id):
    serializer = ChatAutopilotSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {
                'message': 'Validation failed',
                'errors': serializer.errors,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        chat = update_chat_autopilot(
            workspace=request.user.workspace,
            user=request.user,
            chat_id=chat_id,
            enabled=serializer.validated_data['ai_autopilot_enabled'],
        )
    except ChatServiceError as error:
        return Response(error.response_data, status=error.status_code)
    return Response(ChatSerializer(chat).data)


class ChatsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        page = _positive_int(
            request.query_params.get('page'),
            default=1,
            maximum=2_147_483_647,
        )
        limit = _positive_int(
            request.query_params.get('limit'),
            default=20,
            maximum=100,
        )
        if page is None:
            return _query_error('page', 'Некорректный номер страницы.')
        if limit is None:
            return _query_error('limit', 'Значение должно быть от 1 до 100.')
        queryset = Chat.objects.select_related('contact').filter(
            workspace=request.user.workspace,
            is_deleted=False,
        ).order_by('-last_message_at', '-id')
        total = queryset.count()
        offset = (page - 1) * limit
        return Response(
            {
                'chats': ChatSerializer(
                    queryset[offset:offset + limit],
                    many=True,
                ).data,
                'page': page,
                'limit': limit,
                'total': total,
            },
        )


class ChatMessagesView(APIView):
    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        if self.request.method == 'POST':
            # ТЗ 12.4.5: лимит применяется отдельно к каждому чату —
            # не более 20 сообщений за 10 секунд. Дополнительный лимит на весь
            # workspace здесь недопустим: активность в одном диалоге не должна
            # блокировать отправку в другом.
            return [ChatMessageThrottle()]
        return super().get_throttles()

    def throttled(self, request, wait):
        raise MessageRateLimitExceeded()

    def get(self, request, chat_id):
        limit = _positive_int(
            request.query_params.get('limit'),
            default=50,
            maximum=100,
        )
        if limit is None:
            return _query_error('limit', 'Значение должно быть от 1 до 100.')
        try:
            chat = get_chat(workspace=request.user.workspace, chat_id=chat_id)
            messages, next_cursor, has_more = get_messages_page(
                chat=chat,
                limit=limit,
                cursor=request.query_params.get('cursor'),
            )
        except ChatServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(
            {
                'messages': MessageSerializer(messages, many=True).data,
                'next_cursor': next_cursor,
                'has_more': has_more,
            },
        )

    def post(self, request, chat_id):
        attachment = request.FILES.get('attachment')
        if attachment is not None and attachment.size > MAX_ATTACHMENT_SIZE:
            raise AttachmentTooLarge()

        serializer = OutgoingMessageSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {
                    'message': 'Validation failed',
                    'errors': serializer.errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            message, replayed = enqueue_outgoing_message(
                workspace=request.user.workspace,
                user=request.user,
                chat_id=chat_id,
                text=serializer.validated_data['text'],
                attachment=serializer.validated_data.get('attachment'),
                idempotency_key=request.headers.get('Idempotency-Key'),
                audit_context=request_audit_context(request),
            )
        except ChatServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(
            MessageSerializer(message).data,
            status=(
                status.HTTP_200_OK if replayed else status.HTTP_201_CREATED
            ),
        )


class ChatReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, chat_id):
        try:
            mark_chat_read(
                workspace=request.user.workspace,
                user=request.user,
                chat_id=chat_id,
                audit_context=request_audit_context(request),
            )
        except ChatServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChatDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, chat_id):
        try:
            chat = get_chat(workspace=request.user.workspace, chat_id=chat_id)
        except ChatServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(ChatSerializer(chat).data)

    def patch(self, request, chat_id):
        return _update_chat_settings(request, chat_id)

    def delete(self, request, chat_id):
        try:
            delete_chat(
                workspace=request.user.workspace,
                user=request.user,
                chat_id=chat_id,
                audit_context=request_audit_context(request),
            )
        except ChatServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChatSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, chat_id):
        return _update_chat_settings(request, chat_id)
