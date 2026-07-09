from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .chat_serializers import (
    AIChatMessageSerializer,
    AIChatRequestSerializer,
    AIChatRetrySerializer,
    AIChatSessionCreateSerializer,
    AIChatSessionSerializer,
)
from .chat_services import (
    AIChatServiceError,
    close_chat_session,
    create_chat_session,
    get_chat_session,
    retry_chat_message,
    send_chat_message,
)
from .cursors import InvalidCursor, decode_cursor, encode_cursor
from .models import AIChatMessage, AIChatSession


def _error(code, description, http_status, **extra):
    data = {'error': {'code': code, 'message': description}}
    data.update(extra)
    return Response(data, status=http_status)


def _validation_error(errors):
    return _error(
        'VALIDATION_ERROR',
        'Ошибка валидации.',
        status.HTTP_400_BAD_REQUEST,
        fields=errors,
    )


def _limit(request, default=20):
    value = request.query_params.get('limit')
    if value is None:
        return default
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise ValueError from None
    if not 1 <= value <= 100:
        raise ValueError
    return value


def _service_error(error):
    extra = {}
    if error.message_object is not None:
        extra['message'] = AIChatMessageSerializer(error.message_object).data
    return _error(error.code, error.message, error.status_code, **extra)


class AIChatSessionCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = AIChatSessionCreateSerializer(data=request.data or {})
        if not serializer.is_valid():
            return _validation_error(serializer.errors)
        session = create_chat_session(
            workspace=request.user.workspace,
            user=request.user,
            context=serializer.validated_data.get('context'),
        )
        return Response(
            {
                'session_id': str(session.id),
                'created_at': session.created_at,
            },
            status=status.HTTP_200_OK,
        )


class AIChatSessionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            limit = _limit(request)
        except ValueError:
            return _error(
                'VALIDATION_ERROR',
                'limit должен быть от 1 до 100.',
                status.HTTP_400_BAD_REQUEST,
            )
        queryset = AIChatSession.objects.filter(
            workspace=request.user.workspace,
            user=request.user,
            deleted_at__isnull=True,
        )
        cursor = request.query_params.get('cursor')
        if cursor:
            try:
                timestamp, object_id = decode_cursor(cursor, kind='sessions')
            except InvalidCursor:
                return _error(
                    'INVALID_CURSOR',
                    'Некорректный cursor.',
                    status.HTTP_400_BAD_REQUEST,
                )
            queryset = queryset.filter(
                Q(last_activity_at__lt=timestamp)
                | Q(last_activity_at=timestamp, id__lt=object_id),
            )
        items = list(queryset.order_by('-last_activity_at', '-id')[:limit + 1])
        has_more = len(items) > limit
        items = items[:limit]
        next_cursor = None
        if has_more and items:
            last = items[-1]
            next_cursor = encode_cursor(
                kind='sessions',
                timestamp=last.last_activity_at,
                object_id=last.id,
            )
        return Response(
            {
                'sessions': AIChatSessionSerializer(items, many=True).data,
                'next_cursor': next_cursor,
                'has_more': has_more,
            },
        )


class AIChatSessionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, session_id):
        session = get_chat_session(
            workspace=request.user.workspace,
            user=request.user,
            session_id=session_id,
        )
        if session is None:
            return _error(
                'SESSION_NOT_FOUND',
                'Сессия не найдена.',
                status.HTTP_404_NOT_FOUND,
            )
        messages = list(
            session.messages.filter(deleted_at__isnull=True)
            .order_by('-created_at', '-id')[:20],
        )
        messages.reverse()
        data = AIChatSessionSerializer(session).data
        data['messages'] = AIChatMessageSerializer(messages, many=True).data
        return Response(data)


class AIChatSessionCloseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, session_id):
        try:
            close_chat_session(
                workspace=request.user.workspace,
                user=request.user,
                session_id=session_id,
            )
        except AIChatServiceError as error:
            return _service_error(error)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AIChatView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = AIChatRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return _validation_error(serializer.errors)
        try:
            message, replayed = send_chat_message(
                workspace=request.user.workspace,
                user=request.user,
                validated_data=serializer.validated_data,
            )
        except AIChatServiceError as error:
            return _service_error(error)
        response = Response(
            {'message': AIChatMessageSerializer(message).data},
            status=status.HTTP_200_OK,
        )
        if replayed:
            response['Idempotency-Replayed'] = 'true'
        return response


class AIChatRetryView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = AIChatRetrySerializer(data=request.data)
        if not serializer.is_valid():
            return _validation_error(serializer.errors)
        try:
            message = retry_chat_message(
                workspace=request.user.workspace,
                user=request.user,
                **serializer.validated_data,
            )
        except AIChatServiceError as error:
            return _service_error(error)
        return Response(
            {'message': AIChatMessageSerializer(message).data},
            status=status.HTTP_200_OK,
        )


class AIChatHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            limit = _limit(request)
        except ValueError:
            return _error(
                'VALIDATION_ERROR',
                'limit должен быть от 1 до 100.',
                status.HTTP_400_BAD_REQUEST,
            )
        queryset = AIChatMessage.objects.filter(
            workspace=request.user.workspace,
            user=request.user,
            deleted_at__isnull=True,
            session__deleted_at__isnull=True,
        )
        cursor = request.query_params.get('cursor')
        if cursor:
            try:
                timestamp, object_id = decode_cursor(cursor, kind='messages')
            except InvalidCursor:
                return _error(
                    'INVALID_CURSOR',
                    'Некорректный cursor.',
                    status.HTTP_400_BAD_REQUEST,
                )
            queryset = queryset.filter(
                Q(created_at__lt=timestamp)
                | Q(created_at=timestamp, id__lt=object_id),
            )
        items = list(queryset.order_by('-created_at', '-id')[:limit + 1])
        has_more = len(items) > limit
        items = items[:limit]
        next_cursor = None
        if has_more and items:
            last = items[-1]
            next_cursor = encode_cursor(
                kind='messages',
                timestamp=last.created_at,
                object_id=last.id,
            )
        return Response(
            {
                'messages': AIChatMessageSerializer(items, many=True).data,
                'next_cursor': next_cursor,
                'has_more': has_more,
            },
        )


class AIChatMessageView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, message_id):
        message = AIChatMessage.objects.filter(
            id=message_id,
            workspace=request.user.workspace,
            user=request.user,
            deleted_at__isnull=True,
        ).first()
        if message is None:
            return _error(
                'MESSAGE_NOT_FOUND',
                'Сообщение не найдено.',
                status.HTTP_404_NOT_FOUND,
            )
        return Response(
            {
                'id': str(message.id),
                'status': message.status,
                'content': message.content if message.status != 'pending' else '',
            },
        )
