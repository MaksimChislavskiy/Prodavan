from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from messaging.realtime import broadcast_user_event

from .models import Notification


AGGREGATION_WINDOW = timedelta(seconds=60)


class NotificationServiceError(Exception):
    def __init__(self, code, message, *, status_code=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def notification_payload(notification):
    return {
        'id': str(notification.id),
        'type': notification.type,
        'title': notification.title,
        'content': notification.content,
        'link': notification.link,
        'entity_type': notification.entity_type,
        'entity_id': notification.entity_id,
        'is_read': notification.is_read,
        'read_at': (
            notification.read_at.isoformat()
            if notification.read_at is not None
            else None
        ),
        'is_deleted': notification.is_deleted,
        'deleted_at': (
            notification.deleted_at.isoformat()
            if notification.deleted_at is not None
            else None
        ),
        'created_at': notification.created_at.isoformat(),
    }


def unread_count(user):
    return Notification.objects.filter(
        user=user,
        is_deleted=False,
        is_read=False,
    ).count()


def create_notification(
    *,
    user,
    type,
    title,
    content,
    link='',
    entity_type='',
    entity_id='',
    now=None,
):
    now = now or timezone.now()
    with transaction.atomic():
        notification = _recent_duplicate(
            user=user,
            type=type,
            entity_type=entity_type,
            entity_id=entity_id,
            now=now,
        )
        event_name = 'notification_updated'
        if notification is None:
            notification = Notification.objects.create(
                workspace=user.workspace,
                user=user,
                type=type,
                title=title.strip()[:60],
                content=content.strip()[:255],
                link=link.strip()[:500],
                entity_type=entity_type.strip()[:50],
                entity_id=entity_id.strip()[:36],
            )
            event_name = 'notification_created'
        else:
            notification.title = title.strip()[:60]
            notification.content = content.strip()[:255]
            notification.link = link.strip()[:500]
            notification.entity_type = entity_type.strip()[:50]
            notification.entity_id = entity_id.strip()[:36]
            notification.is_read = False
            notification.read_at = None
            notification.save(update_fields=(
                'title',
                'content',
                'link',
                'entity_type',
                'entity_id',
                'is_read',
                'read_at',
                'updated_at',
            ))
        _broadcast_notification(user.id, event_name, notification)
        _broadcast_unread_count(user.id)
        return notification


def mark_notification_read(*, user, notification_id):
    with transaction.atomic():
        notification = _notification_for_update(user=user, notification_id=notification_id)
        if not notification.is_read:
            notification.is_read = True
            notification.read_at = timezone.now()
            notification.save(update_fields=('is_read', 'read_at', 'updated_at'))
            _broadcast_read(user.id, notification)
            _broadcast_unread_count(user.id)
        return notification


def mark_all_read(*, user):
    now = timezone.now()
    with transaction.atomic():
        updated = Notification.objects.filter(
            user=user,
            is_deleted=False,
            is_read=False,
        ).update(is_read=True, read_at=now, updated_at=now)
        if updated:
            _broadcast_unread_count(user.id)
        return updated


def delete_notification(*, user, notification_id):
    with transaction.atomic():
        notification = _notification_for_update(user=user, notification_id=notification_id)
        was_unread = not notification.is_read
        notification.is_deleted = True
        notification.deleted_at = timezone.now()
        notification.save(update_fields=('is_deleted', 'deleted_at', 'updated_at'))
        _broadcast_deleted(user.id, notification.id)
        if was_unread:
            _broadcast_unread_count(user.id)
        return notification


def delete_all_notifications(*, user):
    now = timezone.now()
    with transaction.atomic():
        queryset = Notification.objects.filter(user=user, is_deleted=False)
        had_unread = queryset.filter(is_read=False).exists()
        deleted = queryset.update(
            is_deleted=True,
            deleted_at=now,
            updated_at=now,
        )
        if deleted:
            transaction.on_commit(
                lambda: broadcast_user_event(
                    user.id,
                    {
                        'event': 'notifications_deleted',
                        'payload': {'deleted_count': deleted},
                    },
                ),
            )
            if had_unread:
                _broadcast_unread_count(user.id)
        return deleted


def _recent_duplicate(*, user, type, entity_type, entity_id, now):
    if not entity_type or not entity_id:
        return None
    return (
        Notification.objects.select_for_update()
        .filter(
            user=user,
            type=type,
            entity_type=entity_type,
            entity_id=entity_id,
            is_deleted=False,
            created_at__gte=now - AGGREGATION_WINDOW,
        )
        .order_by('-created_at', '-id')
        .first()
    )


def _notification_for_update(*, user, notification_id):
    notification = (
        Notification.objects.select_for_update()
        .filter(id=notification_id, user=user, is_deleted=False)
        .first()
    )
    if notification is None:
        raise NotificationServiceError(
            'NOTIFICATION_NOT_FOUND',
            'Уведомление не найдено.',
            status_code=404,
        )
    return notification


def _broadcast_notification(user_id, event_name, notification):
    payload = {'event': event_name, 'payload': notification_payload(notification)}
    transaction.on_commit(lambda: broadcast_user_event(user_id, payload))


def _broadcast_read(user_id, notification):
    payload = {
        'event': 'notification_read',
        'payload': {
            'id': str(notification.id),
            'read_at': notification.read_at.isoformat(),
        },
    }
    transaction.on_commit(lambda: broadcast_user_event(user_id, payload))


def _broadcast_deleted(user_id, notification_id):
    payload = {
        'event': 'notification_deleted',
        'payload': {'id': str(notification_id)},
    }
    transaction.on_commit(lambda: broadcast_user_event(user_id, payload))


def _broadcast_unread_count(user_id):
    transaction.on_commit(
        lambda: broadcast_user_event(
            user_id,
            {
                'event': 'unread_count_updated',
                'payload': {
                    'unread_count': Notification.objects.filter(
                        user_id=user_id,
                        is_deleted=False,
                        is_read=False,
                    ).count(),
                },
            },
        ),
    )
