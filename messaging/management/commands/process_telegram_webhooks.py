from django.core.management.base import BaseCommand

from messaging.telegram import process_pending_telegram_webhooks


class Command(BaseCommand):
    help = 'Обрабатывает очередь входящих Telegram webhook.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        limit = options['limit']
        if not 1 <= limit <= 1000:
            raise ValueError('--limit должен быть от 1 до 1000.')
        result = process_pending_telegram_webhooks(limit=limit)
        self.stdout.write(
            self.style.SUCCESS(
                f"Обработано: {result['processed']}; ошибок: {result['failed']}.",
            ),
        )
