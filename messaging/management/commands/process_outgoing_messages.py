from django.core.management.base import BaseCommand

from messaging.outgoing import process_pending_outgoing_messages


class Command(BaseCommand):
    help = 'Отправляет очередь исходящих сообщений через Telegram.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        limit = options['limit']
        if not 1 <= limit <= 1000:
            raise ValueError('--limit должен быть от 1 до 1000.')
        processed = process_pending_outgoing_messages(limit=limit)
        self.stdout.write(
            self.style.SUCCESS(f'Обработано исходящих сообщений: {processed}.'),
        )
