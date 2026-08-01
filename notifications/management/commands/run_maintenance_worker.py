import signal
from time import monotonic, sleep

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from ai_assistant.maintenance import close_inactive_chat_sessions
from notifications.deal_attention import create_deal_attention_notifications
from notifications.missed_chat_messages import create_missed_chat_notifications
from notifications.task_deadlines import create_task_deadline_notifications
from users.maintenance import cleanup_expired_auth_records
from workspaces.telegram_services import check_all_telegram_integrations


class Command(BaseCommand):
    help = (
        'Запускает периодические уведомления и обслуживание приложения. '
        'Без --watch выполняет один диагностический проход.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--watch',
            action='store_true',
            help='Непрерывно выполнять задачи по расписанию.',
        )
        parser.add_argument(
            '--notification-interval',
            type=int,
            default=60,
            help='Интервал проверок уведомлений в секундах.',
        )
        parser.add_argument(
            '--telegram-interval',
            type=int,
            default=300,
            help='Интервал проверки Telegram-интеграций в секундах.',
        )
        parser.add_argument(
            '--ai-session-interval',
            type=int,
            default=300,
            help='Интервал закрытия неактивных AI-сессий в секундах.',
        )
        parser.add_argument(
            '--auth-cleanup-interval',
            type=int,
            default=86_400,
            help='Интервал очистки временных auth-записей в секундах.',
        )

    def handle(self, *args, **options):
        intervals = {
            'notifications': options['notification_interval'],
            'telegram': options['telegram_interval'],
            'ai_sessions': options['ai_session_interval'],
            'auth_cleanup': options['auth_cleanup_interval'],
        }
        invalid_names = [name for name, value in intervals.items() if value < 1]
        if invalid_names:
            raise CommandError(
                'Интервалы должны быть больше нуля: '
                f'{", ".join(invalid_names)}.',
            )

        if not options['watch']:
            self._run_all_tasks()
            return

        self._run_worker(intervals)

    def _run_worker(self, intervals):
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
                continue

        tasks = {
            'notifications': self._run_notifications,
            'telegram': self._run_telegram_check,
            'ai_sessions': self._run_ai_session_cleanup,
            'auth_cleanup': self._run_auth_cleanup,
        }
        started_at = monotonic()
        next_run_at = {name: started_at for name in tasks}

        self.stdout.write('Maintenance worker запущен.')
        stopped_cleanly = False
        try:
            while not stop_requested:
                now = monotonic()
                for name, task in tasks.items():
                    if stop_requested:
                        break
                    if now < next_run_at[name]:
                        continue
                    self._run_task(task)
                    next_run_at[name] = monotonic() + intervals[name]

                if stop_requested:
                    break
                delay = max(0.0, min(next_run_at.values()) - monotonic())
                sleep(min(delay, 1.0))
            stopped_cleanly = True
        except KeyboardInterrupt:
            stopped_cleanly = True
        finally:
            for signal_number, handler in previous_handlers.items():
                signal.signal(signal_number, handler)

        if stopped_cleanly:
            self.stdout.write(self.style.WARNING('Maintenance worker остановлен.'))

    def _run_all_tasks(self):
        for task in (
            self._run_notifications,
            self._run_telegram_check,
            self._run_ai_session_cleanup,
            self._run_auth_cleanup,
        ):
            self._run_task(task)

    @staticmethod
    def _run_task(task):
        close_old_connections()
        try:
            task()
        finally:
            close_old_connections()

    def _run_notifications(self):
        deadline = create_task_deadline_notifications()
        missed = create_missed_chat_notifications()
        deals = create_deal_attention_notifications()
        created = sum(
            result['notifications_created']
            for result in (deadline, missed, deals)
        )
        self.stdout.write(
            self.style.SUCCESS(
                f'Периодические уведомления: создано {created}.',
            ),
        )

    def _run_telegram_check(self):
        checked = check_all_telegram_integrations()
        self.stdout.write(
            self.style.SUCCESS(f'Telegram-интеграций проверено: {checked}.'),
        )

    def _run_ai_session_cleanup(self):
        closed = close_inactive_chat_sessions(
            idle_minutes=settings.AI_CHAT_SESSION_IDLE_MINUTES,
        )
        self.stdout.write(
            self.style.SUCCESS(f'Неактивных AI-сессий закрыто: {closed}.'),
        )

    def _run_auth_cleanup(self):
        counters = cleanup_expired_auth_records()
        self.stdout.write(
            self.style.SUCCESS(
                f'Временных auth-записей удалено: {counters["total"]}.',
            ),
        )
