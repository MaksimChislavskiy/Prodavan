from django.core.management.base import BaseCommand

from ai_assistant.autopilot import process_pending_autopilot_jobs


class Command(BaseCommand):
    help = 'Обрабатывает очередь ответов AI-автопилота.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        limit = options['limit']
        if not 1 <= limit <= 1000:
            raise ValueError('--limit должен быть от 1 до 1000.')
        result = process_pending_autopilot_jobs(limit=limit)
        self.stdout.write(
            self.style.SUCCESS(
                f"Обработано: {result['processed']}; "
                f"отправлено: {result['sent']}; "
                f"пропущено: {result['skipped']}; "
                f"ошибок: {result['failed']}; "
                f"перенесено: {result['rescheduled']}.",
            ),
        )
