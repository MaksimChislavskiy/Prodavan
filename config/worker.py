import signal
from time import sleep

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections


class QueueWorkerCommand(BaseCommand):
    """Base command for bounded queue batches and long-running workers."""

    default_limit = 100
    max_limit = 1000
    worker_name = 'Queue worker'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=self.default_limit)
        parser.add_argument(
            '--watch',
            action='store_true',
            help='Непрерывно опрашивать очередь.',
        )
        parser.add_argument(
            '--poll-interval',
            type=float,
            default=1.0,
            help='Интервал опроса неполной очереди в секундах (0.1–5).',
        )

    def handle(self, *args, **options):
        limit = options['limit']
        if not 1 <= limit <= self.max_limit:
            raise CommandError(
                f'--limit должен быть от 1 до {self.max_limit}.',
            )

        poll_interval = options['poll_interval']
        if not 0.1 <= poll_interval <= 5:
            raise CommandError(
                '--poll-interval должен быть от 0.1 до 5 секунд.',
            )

        if not options['watch']:
            self._process_once(limit)
            return

        self._run_worker(limit=limit, poll_interval=poll_interval)

    def _run_worker(self, *, limit, poll_interval):
        stop_requested = False
        previous_handlers = {}

        def request_stop(signum, frame):
            nonlocal stop_requested
            stop_requested = True

        for signal_number in (signal.SIGINT, signal.SIGTERM):
            try:
                previous_handlers[signal_number] = signal.signal(
                    signal_number,
                    request_stop,
                )
            except (OSError, ValueError):
                # Signals can only be registered by the main thread and some
                # platforms do not expose every signal.
                continue

        self.stdout.write(f'{self.worker_name} запущен.')
        stopped_cleanly = False
        try:
            while not stop_requested:
                result = self._process_once(limit, quiet_when_idle=True)
                if stop_requested:
                    break
                if self.get_processed_count(result) < limit:
                    sleep(poll_interval)
            stopped_cleanly = True
        except KeyboardInterrupt:
            stopped_cleanly = True
        finally:
            for signal_number, handler in previous_handlers.items():
                signal.signal(signal_number, handler)

        if stopped_cleanly:
            self.stdout.write(
                self.style.WARNING(f'{self.worker_name} остановлен.'),
            )

    def _process_once(self, limit, *, quiet_when_idle=False):
        close_old_connections()
        try:
            result = self.process_batch(limit)
        finally:
            close_old_connections()
        if not quiet_when_idle or not self.is_idle(result):
            self.stdout.write(self.style.SUCCESS(self.format_result(result)))
        return result

    def process_batch(self, limit):
        raise NotImplementedError

    def format_result(self, result):
        raise NotImplementedError

    def get_processed_count(self, result):
        if isinstance(result, int):
            return result
        return result['processed']

    def is_idle(self, result):
        if isinstance(result, int):
            return result == 0
        return not any(result.values())
