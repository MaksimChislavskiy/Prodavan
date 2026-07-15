from io import StringIO
from unittest.mock import patch

from django.core.management import CommandError, call_command
from django.test import SimpleTestCase


class AIWorkerCommandTests(SimpleTestCase):
    @patch(
        'ai_assistant.management.commands.process_ai_automation_events.sleep',
        side_effect=KeyboardInterrupt,
    )
    @patch(
        'ai_assistant.management.commands.process_ai_automation_events.'
        'process_pending_automation_events',
        return_value={
            'processed': 0,
            'completed': 0,
            'failed': 0,
            'ignored': 0,
            'rescheduled': 0,
        },
    )
    def test_automation_watch_polls_empty_queue_and_stops_cleanly(
        self,
        process,
        sleeper,
    ):
        output = StringIO()

        call_command(
            'process_ai_automation_events',
            '--watch',
            '--limit',
            '1000',
            '--poll-interval',
            '0.5',
            stdout=output,
        )

        process.assert_called_once_with(limit=1000)
        sleeper.assert_called_once_with(0.5)
        self.assertIn('worker запущен', output.getvalue())
        self.assertIn('worker остановлен', output.getvalue())

    @patch(
        'ai_assistant.management.commands.process_ai_autopilot_jobs.sleep',
        side_effect=KeyboardInterrupt,
    )
    @patch(
        'ai_assistant.management.commands.process_ai_autopilot_jobs.'
        'process_pending_autopilot_jobs',
        return_value={
            'processed': 0,
            'sent': 0,
            'skipped': 0,
            'failed': 0,
            'cancelled': 0,
            'rescheduled': 0,
            'cleaned': 0,
        },
    )
    def test_autopilot_watch_polls_empty_queue_and_stops_cleanly(
        self,
        process,
        sleeper,
    ):
        output = StringIO()

        call_command(
            'process_ai_autopilot_jobs',
            '--watch',
            '--poll-interval',
            '1',
            stdout=output,
        )

        process.assert_called_once_with(limit=100)
        sleeper.assert_called_once_with(1.0)
        self.assertIn('worker запущен', output.getvalue())
        self.assertIn('worker остановлен', output.getvalue())

    @patch(
        'ai_assistant.management.commands.process_ai_automation_events.sleep',
    )
    @patch(
        'ai_assistant.management.commands.process_ai_automation_events.'
        'process_pending_automation_events',
        side_effect=[
            {
                'processed': 1000,
                'completed': 1000,
                'failed': 0,
                'ignored': 0,
                'rescheduled': 0,
            },
            KeyboardInterrupt,
        ],
    )
    def test_full_automation_batch_continues_without_polling_delay(
        self,
        process,
        sleeper,
    ):
        call_command(
            'process_ai_automation_events',
            '--watch',
            '--limit',
            '1000',
            stdout=StringIO(),
        )

        self.assertEqual(process.call_count, 2)
        sleeper.assert_not_called()

    def test_worker_commands_reject_polling_slower_than_nfr(self):
        for command_name in (
            'process_ai_automation_events',
            'process_ai_autopilot_jobs',
        ):
            with self.subTest(command=command_name):
                with self.assertRaisesMessage(
                    CommandError,
                    '--poll-interval должен быть от 0.1 до 5 секунд.',
                ):
                    call_command(command_name, '--poll-interval', '5.1')
