from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .cursors import (
    InvalidCursor,
    decode_notification_cursor,
    encode_notification_cursor,
)
from .models import Notification
from .serializers import NotificationSerializer
from .services import (
    NotificationServiceError,
    delete_all_notifications,
    delete_notification,
    mark_all_read,
    mark_notification_read,
    unread_count,
)


def _error(code, message, http_status):
    return Response(
        {'error': {'code': code, 'message': message}},
        status=http_status,
    )


def _positive_int(value, default):
    try:
        result = default if value is None else int(value)
    except (TypeError, ValueError):
        raise ValueError from None
    if not 1 <= result <= 100:
        raise ValueError
    return result


def _service_error(error):
    return _error(error.code, error.message, error.status_code)


class NotificationsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            limit = _positive_int(request.query_params.get('limit'), 50)
        except ValueError:
            return _error(
                'VALIDATION_ERROR',
                'limit должен быть от 1 до 100.',
                status.HTTP_400_BAD_REQUEST,
            )
        queryset = Notification.objects.filter(
            user=request.user,
            is_deleted=False,
        )
        cursor = request.query_params.get('cursor')
        if cursor:
            try:
                created_at, notification_id = decode_notification_cursor(cursor)
            except InvalidCursor:
                return _error(
                    'INVALID_CURSOR',
                    'Некорректный cursor.',
                    status.HTTP_400_BAD_REQUEST,
                )
            queryset = queryset.filter(
                Q(created_at__lt=created_at)
                | Q(created_at=created_at, id__lt=notification_id),
            )
        rows = list(queryset.order_by('-created_at', '-id')[:limit + 1])
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = (
            encode_notification_cursor(rows[-1])
            if has_more and rows
            else None
        )
        return Response(
            {
                'notifications': NotificationSerializer(rows, many=True).data,
                'next_cursor': next_cursor,
                'has_more': has_more,
            },
        )

    def delete(self, request):
        delete_all_notifications(user=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationUnreadCountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({'unread_count': unread_count(request.user)})


class NotificationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, notification_id):
        try:
            delete_notification(user=request.user, notification_id=notification_id)
        except NotificationServiceError as error:
            return _service_error(error)
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, notification_id):
        try:
            notification = mark_notification_read(
                user=request.user,
                notification_id=notification_id,
            )
        except NotificationServiceError as error:
            return _service_error(error)
        return Response({'notification': NotificationSerializer(notification).data})


class NotificationMarkAllReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        updated = mark_all_read(user=request.user)
        return Response({'updated': updated, 'unread_count': 0})
