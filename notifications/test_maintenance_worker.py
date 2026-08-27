import signal
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase


COMMAND_MODULE = 'notifications.management.commands.run_maintenance_worker'


class MaintenanceWorkerCommandTests(SimpleTestCase):
    def setUp(self):
        self.task_patches = (
            patch(
                f'{COMMAND_MODULE}.create_task_deadline_notifications',
                return_value={'notifications_created': 1},
            ),
            patch(
                f'{COMMAND_MODULE}.create_overdue_task_summary_notifications',
                return_value={'summaries_changed': 4},
            ),
            patch(
                f'{COMMAND_MODULE}.create_missed_chat_notifications',
                return_value={'notifications_created': 2},
            ),
            patch(
                f'{COMMAND_MODULE}.create_deal_attention_notifications',
                return_value={'notifications_created': 3},
            ),
            patch(
                f'{COMMAND_MODULE}.check_all_telegram_integrations',
                return_value=4,
            ),
            patch(
                f'{COMMAND_MODULE}.close_inactive_chat_sessions',
                return_value=5,
            ),
            patch(
                f'{COMMAND_MODULE}.cleanup_expired_auth_records',
                return_value={'total': 6},
            ),
        )
        self.tasks = [task_patch.start() for task_patch in self.task_patches]
        self.addCleanup(self._stop_task_patches)

    def _stop_task_patches(self):
        for task_patch in reversed(self.task_patches):
            task_patch.stop()

    def test_one_off_mode_runs_every_task(self):
        stdout = StringIO()

        call_command('run_maintenance_worker', stdout=stdout)

        for task in self.tasks:
            task.assert_called_once()
        self.assertIn(
            'Периодические уведомления: создано/обновлено 10.',
            stdout.getvalue(),
        )
        self.assertIn('Telegram-интеграций проверено: 4.', stdout.getvalue())
        self.assertIn('Неактивных AI-сессий закрыто: 5.', stdout.getvalue())
        self.assertIn('Временных auth-записей удалено: 6.', stdout.getvalue())

    def test_worker_stops_cleanly_on_sigterm(self):
        handlers = {}

        def register_handler(signal_number, handler):
            previous = handlers.get(signal_number, signal.SIG_DFL)
            handlers[signal_number] = handler
            return previous

        def request_stop(_delay):
            handlers[signal.SIGTERM](signal.SIGTERM, None)

        stdout = StringIO()
        with (
            patch(f'{COMMAND_MODULE}.signal.signal', side_effect=register_handler),
            patch(f'{COMMAND_MODULE}.monotonic', return_value=0.0),
            patch(f'{COMMAND_MODULE}.sleep', side_effect=request_stop) as sleeper,
        ):
            call_command('run_maintenance_worker', watch=True, stdout=stdout)

        sleeper.assert_called_once_with(1.0)
        for task in self.tasks:
            task.assert_called_once()
        self.assertIn('Maintenance worker запущен.', stdout.getvalue())
        self.assertIn('Maintenance worker остановлен.', stdout.getvalue())

    def test_worker_runs_tasks_on_independent_intervals(self):
        handlers = {}
        clock = [0.0]

        def register_handler(signal_number, handler):
            previous = handlers.get(signal_number, signal.SIG_DFL)
            handlers[signal_number] = handler
            return previous

        def advance_clock(delay):
            clock[0] += delay
            if clock[0] >= 6:
                handlers[signal.SIGTERM](signal.SIGTERM, None)

        with (
            patch(f'{COMMAND_MODULE}.signal.signal', side_effect=register_handler),
            patch(f'{COMMAND_MODULE}.monotonic', side_effect=lambda: clock[0]),
            patch(f'{COMMAND_MODULE}.sleep', side_effect=advance_clock),
        ):
            call_command(
                'run_maintenance_worker',
                watch=True,
                notification_interval=2,
                telegram_interval=3,
                ai_session_interval=4,
                auth_cleanup_interval=5,
                stdout=StringIO(),
            )

        for task in self.tasks[:4]:
            self.assertEqual(task.call_count, 3)
        self.assertEqual(self.tasks[4].call_count, 2)
        self.assertEqual(self.tasks[5].call_count, 2)
        self.assertEqual(self.tasks[6].call_count, 2)

    def test_worker_rejects_non_positive_intervals(self):
        with self.assertRaisesMessage(
            CommandError,
            'Интервалы должны быть больше нуля: notifications.',
        ):
            call_command(
                'run_maintenance_worker',
                watch=True,
                notification_interval=0,
            )

        for task in self.tasks:
            task.assert_not_called()
