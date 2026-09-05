from django.test import TestCase

from contacts.models import Contact
from messaging.models import Chat, Message, MessageSenderType, MessageStatus
from tasks.models import Task
from users.models import User
from workspaces.models import IntegrationStatus, IntegrationType, WorkspaceIntegration

from .autopilot import process_autopilot_job
from .chat_client import ChatCompletionResult
from .models import AIAutopilotJob, AISettings, AutopilotJobStatus, AutopilotMode
from .retrieval import RetrievedChunk


class LowConfidenceCompletionClient:
    def complete(self, messages):
        return ChatCompletionResult(
            content='{"answer":"Не уверен.","confidence":0.2}',
            model_name='test-model',
            provider='test-provider',
            prompt_tokens=10,
            completion_tokens=3,
            total_tokens=13,
            processing_time_ms=20,
        )


def fake_source():
    return RetrievedChunk(
        chunk_id='chunk-section16',
        document_id='document-section16',
        document_name='FAQ.txt',
        position=1,
        text='Проверочная информация для ответа.',
        score=0.95,
    )


class TelegramAutopilotSection16ContractTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='telegram-autopilot@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.workspace = self.user.workspace
        self.contact = Contact.objects.create(
            workspace=self.workspace,
            name='Клиент',
            telegram_chat_id=12345,
        )
        self.chat = Chat.objects.create(
            workspace=self.workspace,
            contact=self.contact,
        )
        AISettings.objects.create(
            workspace=self.workspace,
            autopilot_enabled=True,
            autopilot_mode=AutopilotMode.FALLBACK,
            autopilot_delay=5,
        )

    def _incoming(self, text):
        return Message.objects.create(
            chat=self.chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=self.contact.id,
            text=text,
        )

    def test_ai_outgoing_message_cancels_pending_fallback(self):
        incoming = self._incoming('Есть вопрос.')

        Message.objects.create(
            chat=self.chat,
            sender_type=MessageSenderType.USER,
            sender_id=self.user.id,
            text='Автоматический ответ.',
            status=MessageStatus.SENT,
            sent_by_ai=True,
        )

        job = AIAutopilotJob.objects.get(trigger_message=incoming)
        self.assertEqual(job.status, AutopilotJobStatus.CANCELLED)
        self.assertEqual(job.last_error, 'ai_replied')

    def test_low_confidence_after_three_customer_messages_creates_escalation_task(self):
        WorkspaceIntegration.objects.create(
            workspace=self.workspace,
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
            config={'test': 'connected'},
        )
        self._incoming('Первое сообщение.')
        self._incoming('Второе сообщение.')
        third = self._incoming('Третье сообщение, нужен менеджер.')
        job = AIAutopilotJob.objects.get(trigger_message=third)

        outcome = process_autopilot_job(
            job.id,
            retrieval_func=lambda **kwargs: [fake_source()],
            completion_client=LowConfidenceCompletionClient(),
            now=job.available_at,
        )

        self.assertEqual(outcome, 'skipped')
        job.refresh_from_db()
        self.assertEqual(job.result['reason'], 'low_confidence')
        self.assertTrue(
            Task.objects.filter(
                workspace=self.workspace,
                title='Срочно: клиент ожидает ответа',
            ).exists(),
        )
