from users.models import UserRole

from .models import Notification, NotificationType
from .services import create_notification


MESSAGE_ENTITY_TYPE = 'message'


def create_delivery_failure_notifications(message):
    created = 0
    users = message.chat.workspace.users.filter(
        role=UserRole.ADMIN,
        is_active=True,
        is_deleted=False,
    ).order_by('created_at', 'id')
    for user in users:
        if Notification.objects.filter(
            user=user,
            type=NotificationType.CHAT_MESSAGE_DELIVERY_FAILED,
            entity_type=MESSAGE_ENTITY_TYPE,
            entity_id=str(message.id),
            is_deleted=False,
        ).exists():
            continue
        create_notification(
            user=user,
            type=NotificationType.CHAT_MESSAGE_DELIVERY_FAILED,
            title='Не удалось доставить сообщение',
            content=(
                f'Сообщение клиенту «{message.chat.contact.name.strip()}» '
                'не доставлено через Telegram.'
            ),
            link=f'/chat/{message.chat_id}',
            entity_type=MESSAGE_ENTITY_TYPE,
            entity_id=str(message.id),
        )
        created += 1
    return created
