from django.core.management.base import BaseCommand

from ai_assistant.automation import process_pending_automation_events


class Command(BaseCommand):
    help = 'Обрабатывает очередь AI-автоматизаций по входящим сообщениям.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        limit = options['limit']
        if not 1 <= limit <= 1000:
            raise ValueError('--limit должен быть от 1 до 1000.')
        result = process_pending_automation_events(limit=limit)
        self.stdout.write(
            self.style.SUCCESS(
                f"Обработано: {result['processed']}; "
                f"готово: {result['completed']}; "
                f"ошибок: {result['failed']}; "
                f"пропущено: {result['ignored']}; "
                f"перенесено: {result['rescheduled']}.",
            ),
        )
