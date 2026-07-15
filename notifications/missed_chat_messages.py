from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from messaging.models import Message, MessageSenderType

from .models import Notification, NotificationType
from .services import create_notification


CHAT_ENTITY_TYPE = 'chat'


def create_missed_chat_notifications(*, now=None):
    now = now or timezone.now()
    cutoff = now - timedelta(minutes=settings.CHAT_MISSED_AFTER_MINUTES)
    oldest_by_chat = {}

    overdue_messages = (
        Message.objects.select_related('chat__workspace', 'chat__contact')
        .filter(
            sender_type=MessageSenderType.CONTACT,
            read_at__isnull=True,
            is_deleted=False,
            chat__is_deleted=False,
            created_at__lte=cutoff,
        )
        .order_by('chat__workspace_id', 'chat_id', 'created_at', 'id')
    )
    for message in overdue_messages:
        oldest_by_chat.setdefault(message.chat_id, message)

    summaries = _unread_summaries(oldest_by_chat)
    counters = {
        'missed_chats': len(oldest_by_chat),
        'unread_messages': sum(item['count'] for item in summaries.values()),
        'notifications_created': 0,
    }
    for chat_id, oldest_message in oldest_by_chat.items():
        counters['notifications_created'] += _notify_chat_users(
            oldest_message.chat,
            oldest_message=oldest_message,
            summary=summaries[chat_id],
            now=now,
        )
    return counters


def _unread_summaries(oldest_by_chat):
    summaries = {
        chat_id: {'count': 0, 'latest': None}
        for chat_id in oldest_by_chat
    }
    unread_messages = (
        Message.objects.filter(
            chat_id__in=oldest_by_chat,
            sender_type=MessageSenderType.CONTACT,
            read_at__isnull=True,
            is_deleted=False,
        )
        .order_by('chat_id', 'created_at', 'id')
    )
    for message in unread_messages:
        summary = summaries[message.chat_id]
        summary['count'] += 1
        summary['latest'] = message
    return summaries


def _notify_chat_users(chat, *, oldest_message, summary, now):
    created = 0
    for user in chat.workspace.users.filter(
        is_active=True,
        is_deleted=False,
    ).order_by('created_at', 'id'):
        if _already_notified_for_unread_period(
            user=user,
            chat=chat,
            oldest_message=oldest_message,
        ):
            continue
        create_notification(
            user=user,
            type=NotificationType.CHAT_MISSED_MESSAGE,
            title='Пропущено сообщение клиента',
            content=_notification_content(chat, summary),
            link=f'/chat/{chat.id}',
            entity_type=CHAT_ENTITY_TYPE,
            entity_id=str(chat.id),
            now=now,
        )
        created += 1
    return created


def _already_notified_for_unread_period(*, user, chat, oldest_message):
    return Notification.objects.filter(
        user=user,
        type=NotificationType.CHAT_MISSED_MESSAGE,
        entity_type=CHAT_ENTITY_TYPE,
        entity_id=str(chat.id),
        created_at__gte=oldest_message.created_at,
    ).exists()


def _notification_content(chat, summary):
    contact_name = chat.contact.name.strip()
    latest_text = ' '.join(summary['latest'].text.split())
    if len(latest_text) > 120:
        latest_text = f'{latest_text[:117]}...'
    if summary['count'] == 1:
        return f'Непрочитанное сообщение от {contact_name}: {latest_text}'
    return (
        f'Непрочитанных сообщений от {contact_name}: {summary["count"]}. '
        f'Последнее: {latest_text}'
    )
