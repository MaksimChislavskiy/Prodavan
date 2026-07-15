import signal
from io import StringIO
from unittest.mock import patch

from django.core.management import CommandError, call_command
from django.test import SimpleTestCase


class AIWorkerCommandTests(SimpleTestCase):
    @patch(
        'config.worker.sleep',
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
        'config.worker.sleep',
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
        'config.worker.sleep',
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
            'process_knowledge_documents',
            'process_telegram_webhooks',
            'process_outgoing_messages',
        ):
            with self.subTest(command=command_name):
                with self.assertRaisesMessage(
                    CommandError,
                    '--poll-interval должен быть от 0.1 до 5 секунд.',
                ):
                    call_command(command_name, '--poll-interval', '5.1')

    @patch('config.worker.sleep', side_effect=KeyboardInterrupt)
    @patch(
        'ai_assistant.management.commands.process_knowledge_documents.'
        'process_pending_knowledge_documents',
        return_value={'processed': 0, 'ready': 0, 'failed': 0},
    )
    def test_knowledge_watch_polls_and_stops_cleanly(self, process, sleeper):
        output = StringIO()

        call_command(
            'process_knowledge_documents',
            '--watch',
            '--poll-interval',
            '0.25',
            stdout=output,
        )

        process.assert_called_once_with(limit=20)
        sleeper.assert_called_once_with(0.25)
        self.assertIn('AI knowledge worker запущен', output.getvalue())
        self.assertIn('AI knowledge worker остановлен', output.getvalue())

    @patch('config.worker.sleep', side_effect=KeyboardInterrupt)
    @patch(
        'messaging.management.commands.process_telegram_webhooks.'
        'process_pending_telegram_webhooks',
        return_value={
            'processed': 0,
            'failed': 0,
            'permanently_failed': 0,
        },
    )
    def test_webhook_watch_polls_and_stops_cleanly(self, process, sleeper):
        output = StringIO()

        call_command(
            'process_telegram_webhooks',
            '--watch',
            stdout=output,
        )

        process.assert_called_once_with(limit=100)
        sleeper.assert_called_once_with(1.0)
        self.assertIn('Telegram webhook worker запущен', output.getvalue())
        self.assertIn('Telegram webhook worker остановлен', output.getvalue())

    @patch('config.worker.sleep', side_effect=KeyboardInterrupt)
    @patch(
        'messaging.management.commands.process_outgoing_messages.'
        'process_pending_outgoing_messages',
        return_value=0,
    )
    def test_outgoing_watch_polls_and_stops_cleanly(self, process, sleeper):
        output = StringIO()

        call_command(
            'process_outgoing_messages',
            '--watch',
            stdout=output,
        )

        process.assert_called_once_with(limit=100)
        sleeper.assert_called_once_with(1.0)
        self.assertIn('Telegram outgoing worker запущен', output.getvalue())
        self.assertIn('Telegram outgoing worker остановлен', output.getvalue())

    def test_knowledge_worker_uses_command_error_for_invalid_limit(self):
        with self.assertRaisesMessage(
            CommandError,
            '--limit должен быть от 1 до 100.',
        ):
            call_command('process_knowledge_documents', '--limit', '101')

    def test_sigterm_stops_worker_after_current_batch(self):
        handlers = {}

        def register_handler(signal_number, handler):
            if callable(handler):
                handlers[signal_number] = handler
            return signal.SIG_DFL

        def process_batch(*, limit):
            handlers[signal.SIGTERM](signal.SIGTERM, None)
            return 0

        output = StringIO()
        with patch(
            'config.worker.signal.signal',
            side_effect=register_handler,
        ), patch(
            'messaging.management.commands.process_outgoing_messages.'
            'process_pending_outgoing_messages',
            side_effect=process_batch,
        ) as process, patch('config.worker.sleep') as sleeper:
            call_command(
                'process_outgoing_messages',
                '--watch',
                stdout=output,
            )

        process.assert_called_once_with(limit=100)
        sleeper.assert_not_called()
        self.assertIn('Telegram outgoing worker остановлен', output.getvalue())
