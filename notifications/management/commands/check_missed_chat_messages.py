from django.core.management.base import BaseCommand

from notifications.missed_chat_messages import create_missed_chat_notifications


class Command(BaseCommand):
    help = 'Создаёт уведомления о пропущенных входящих сообщениях клиентов.'

    def handle(self, *args, **options):
        counters = create_missed_chat_notifications()
        self.stdout.write(
            self.style.SUCCESS(
                'Создано уведомлений: {notifications_created}. '
                'Чатов с пропущенными сообщениями: {missed_chats}. '
                'Непрочитанных сообщений: {unread_messages}.'.format(
                    **counters,
                ),
            ),
        )
