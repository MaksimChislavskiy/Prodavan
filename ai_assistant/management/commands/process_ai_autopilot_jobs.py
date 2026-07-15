from time import sleep

from django.core.management.base import BaseCommand, CommandError

from ai_assistant.autopilot import process_pending_autopilot_jobs


class Command(BaseCommand):
    help = 'Обрабатывает очередь ответов AI-автопилота.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)
        parser.add_argument(
            '--watch',
            action='store_true',
            help='Непрерывно опрашивать очередь.',
        )
        parser.add_argument(
            '--poll-interval',
            type=float,
            default=1.0,
            help='Интервал опроса пустой очереди в секундах (0.1–5).',
        )

    def handle(self, *args, **options):
        limit = options['limit']
        if not 1 <= limit <= 1000:
            raise CommandError('--limit должен быть от 1 до 1000.')
        poll_interval = options['poll_interval']
        if not 0.1 <= poll_interval <= 5:
            raise CommandError('--poll-interval должен быть от 0.1 до 5 секунд.')

        if not options['watch']:
            self._process_once(limit)
            return

        self.stdout.write('AI autopilot worker запущен.')
        try:
            while True:
                result = self._process_once(limit, quiet_when_idle=True)
                if result['processed'] < limit:
                    sleep(poll_interval)
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING('AI autopilot worker остановлен.'))

    def _process_once(self, limit, *, quiet_when_idle=False):
        result = process_pending_autopilot_jobs(limit=limit)
        if quiet_when_idle and not any(result.values()):
            return result
        self.stdout.write(
            self.style.SUCCESS(
                f"Обработано: {result['processed']}; "
                f"отправлено: {result['sent']}; "
                f"пропущено: {result['skipped']}; "
                f"ошибок: {result['failed']}; "
                f"перенесено: {result['rescheduled']}.",
            ),
        )
        return result
