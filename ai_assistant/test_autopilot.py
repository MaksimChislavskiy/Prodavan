from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from contacts.models import Contact
from messaging.models import Chat, Message, MessageSenderType, MessageStatus
from tasks.models import Task
from users.models import User
from workspaces.models import IntegrationStatus, IntegrationType, WorkspaceIntegration

from .autopilot import process_autopilot_job
from .chat_client import ChatCompletionResult
from .models import (
    AIAutopilotJob,
    AIProcessedEvent,
    AISettings,
    AIUsageDaily,
    AutopilotJobStatus,
    AutopilotMode,
    AutomationActionType,
)
from .retrieval import RetrievedChunk


class FakeCompletionClient:
    def __init__(self, content='Ответ из базы знаний.'):
        self.content = content
        self.messages = None

    def complete(self, messages):
        self.messages = messages
        return ChatCompletionResult(
            content=self.content,
            model_name='test-model',
            provider='test-provider',
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            processing_time_ms=25,
        )


def fake_source():
    return RetrievedChunk(
        chunk_id='chunk-1',
        document_id='document-1',
        document_name='FAQ.txt',
        position=1,
        text='Компания работает ежедневно с 10:00 до 19:00.',
        score=0.95,
    )


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class AIAutopilotTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='owner@example.com',
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

    def enable_autopilot(self, *, mode=AutopilotMode.FALLBACK, delay=5):
        return AISettings.objects.create(
            workspace=self.workspace,
            autopilot_enabled=True,
            autopilot_mode=mode,
            autopilot_delay=delay,
        )

    def connect_telegram(self):
        return WorkspaceIntegration.objects.create(
            workspace=self.workspace,
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
            config={'encrypted': 'token'},
        )

    def incoming(self, text):
        return Message.objects.create(
            chat=self.chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=self.contact.id,
            text=text,
        )

    def manager_message(self, text='Отвечу сам.'):
        return Message.objects.create(
            chat=self.chat,
            sender_type=MessageSenderType.USER,
            sender_id=self.user.id,
            text=text,
            status=MessageStatus.SENT,
        )

    def test_always_mode_batches_by_replacing_pending_job(self):
        self.enable_autopilot(mode=AutopilotMode.ALWAYS)

        first = self.incoming('Как работаете?')
        second = self.incoming('И сколько стоит?')

        first_job = AIAutopilotJob.objects.get(trigger_message=first)
        second_job = AIAutopilotJob.objects.get(trigger_message=second)
        self.assertEqual(first_job.status, AutopilotJobStatus.CANCELLED)
        self.assertEqual(second_job.status, AutopilotJobStatus.PENDING)
        self.assertEqual(second_job.mode, AutopilotMode.ALWAYS)
        self.assertGreater(second_job.available_at, timezone.now())

    def test_fallback_job_is_cancelled_when_manager_replies(self):
        self.enable_autopilot(mode=AutopilotMode.FALLBACK, delay=5)
        incoming = self.incoming('Есть вопрос.')

        self.manager_message()

        job = AIAutopilotJob.objects.get(trigger_message=incoming)
        self.assertEqual(job.status, AutopilotJobStatus.CANCELLED)
        self.assertEqual(job.last_error, 'manager_replied')

    def test_process_job_sends_ai_message_and_records_usage(self):
        self.enable_autopilot(mode=AutopilotMode.ALWAYS)
        self.connect_telegram()
        message = self.incoming('Когда вы работаете?')
        job = message.ai_autopilot_job
        now = timezone.now() + timedelta(seconds=11)
        AIAutopilotJob.objects.filter(id=job.id).update(available_at=now)
        completion = FakeCompletionClient()

        outcome = process_autopilot_job(
            job.id,
            retrieval_func=lambda **kwargs: [fake_source()],
            completion_client=completion,
            now=now,
        )

        self.assertEqual(outcome, 'sent')
        reply = Message.objects.get(sender_type=MessageSenderType.USER)
        self.assertTrue(reply.sent_by_ai)
        self.assertEqual(reply.status, MessageStatus.SENT)
        self.assertEqual(reply.next_delivery_attempt_at, now)
        usage = AIUsageDaily.objects.get(workspace=self.workspace)
        self.assertEqual(usage.autopilot_replies, 1)
        job.refresh_from_db()
        self.assertEqual(job.status, AutopilotJobStatus.SENT)
        self.assertEqual(job.reply_message_id, reply.id)
        self.assertEqual(job.sources[0]['document_name'], 'FAQ.txt')
        self.assertIn('Глобальная инструкция', completion.messages[0]['content'])
        processed = AIProcessedEvent.objects.get(
            action_type=AutomationActionType.AUTOPILOT_REPLY,
        )
        self.assertEqual(processed.result['status'], 'sent')

    def test_no_relevant_knowledge_skips_without_reply(self):
        self.enable_autopilot(mode=AutopilotMode.ALWAYS)
        self.connect_telegram()
        message = self.incoming('Расскажите про неизвестный продукт.')
        job = message.ai_autopilot_job
        now = timezone.now() + timedelta(seconds=11)
        AIAutopilotJob.objects.filter(id=job.id).update(available_at=now)

        outcome = process_autopilot_job(
            job.id,
            retrieval_func=lambda **kwargs: [],
            completion_client=FakeCompletionClient(),
            now=now,
        )

        self.assertEqual(outcome, 'skipped')
        self.assertFalse(
            Message.objects.filter(
                sender_type=MessageSenderType.USER,
                sent_by_ai=True,
            ).exists(),
        )
        job.refresh_from_db()
        self.assertEqual(job.result['reason'], 'no_relevant_knowledge')

    def test_no_relevant_knowledge_after_three_customer_messages_escalates_to_task(self):
        self.enable_autopilot(mode=AutopilotMode.ALWAYS)
        self.connect_telegram()
        self.incoming('Есть вопрос.')
        self.incoming('Вы тут?')
        message = self.incoming('Очень жду ответа.')
        job = message.ai_autopilot_job
        now = timezone.now() + timedelta(seconds=11)
        AIAutopilotJob.objects.filter(id=job.id).update(available_at=now)

        outcome = process_autopilot_job(
            job.id,
            retrieval_func=lambda **kwargs: [],
            completion_client=FakeCompletionClient(),
            now=now,
        )

        self.assertEqual(outcome, 'skipped')
        task = Task.objects.get(workspace=self.workspace)
        self.assertTrue(task.created_by_ai)
        self.assertEqual(task.contact_id, self.contact.id)
        self.assertEqual(task.title, 'Срочно: клиент ожидает ответа')
        self.assertIn('no_relevant_knowledge', task.description)
        usage = AIUsageDaily.objects.get(workspace=self.workspace)
        self.assertEqual(usage.tasks_created, 1)
        job.refresh_from_db()
        self.assertEqual(job.result['escalation']['status'], 'created')
        self.assertEqual(job.result['escalation']['task_id'], str(task.id))

    def test_daily_limit_skips_before_generation(self):
        self.enable_autopilot(mode=AutopilotMode.ALWAYS)
        self.connect_telegram()
        AIUsageDaily.objects.create(
            workspace=self.workspace,
            date=timezone.now().date(),
            autopilot_replies=50,
        )
        message = self.incoming('Когда работаете?')
        job = message.ai_autopilot_job
        now = timezone.now() + timedelta(seconds=11)
        AIAutopilotJob.objects.filter(id=job.id).update(available_at=now)
        completion = FakeCompletionClient()

        outcome = process_autopilot_job(
            job.id,
            retrieval_func=lambda **kwargs: [fake_source()],
            completion_client=completion,
            now=now,
        )

        self.assertEqual(outcome, 'skipped')
        self.assertIsNone(completion.messages)
        job.refresh_from_db()
        self.assertEqual(job.result['reason'], 'workspace_daily_reply_limit')

    def test_chat_override_disables_autopilot(self):
        self.enable_autopilot(mode=AutopilotMode.ALWAYS)
        self.chat.ai_autopilot_enabled = False
        self.chat.save(update_fields=('ai_autopilot_enabled', 'updated_at'))

        self.incoming('Не отвечай автоматически.')

        self.assertFalse(AIAutopilotJob.objects.exists())
