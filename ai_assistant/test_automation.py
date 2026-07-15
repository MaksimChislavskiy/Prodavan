from datetime import timedelta, timezone as datetime_timezone
from decimal import Decimal
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from contacts.models import Contact, ContactAuditLog
from deals.models import ChangedByType, Deal, DealHistory, SalesStage
from messaging.models import Chat, Message, MessageSenderType, MessageStatus
from notifications.models import Notification, NotificationType
from tasks.models import Task, TaskSource
from users.models import User

from .automation import (
    AutomationAnalysisClient,
    AutomationBusinessError,
    AutomationTechnicalError,
    process_automation_event,
)
from .chat_client import ChatCompletionResult
from .insights import apply_structured_insights
from .limits import AI_LIMITS
from .models import (
    AIChatInsight,
    AIAutomationAuditAction,
    AIAutomationAuditLog,
    AIAutomationEvent,
    AIProcessedEvent,
    AIUsageDaily,
    AutomationActionType,
    AutomationEventStatus,
    AutomationFailureType,
)


class DummyAnalyzer:
    def __init__(self, payload=None, error=None):
        self.payload = payload or {}
        self.error = error
        self.calls = []

    def analyze(self, *, event, context_messages):
        self.calls.append({
            'event_id': event.id,
            'context_messages': context_messages,
        })
        if self.error is not None:
            raise self.error
        return self.payload


class FakeCompletionClient:
    def __init__(self, content='{}'):
        self.content = content
        self.calls = 0

    def complete(self, messages):
        self.calls += 1
        return ChatCompletionResult(
            content=self.content,
            model_name='test-model',
            provider='test-provider',
            prompt_tokens=1,
            completion_tokens=1,
            total_tokens=2,
            processing_time_ms=10,
        )


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    AI_AUTOMATION_CONFIDENCE_THRESHOLD=0.7,
)
class AIAutomationTests(TestCase):
    def setUp(self):
        cache.clear()
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
            name='Пётр',
        )
        self.chat = Chat.objects.create(
            workspace=self.workspace,
            contact=self.contact,
        )

    def incoming(self, text):
        return Message.objects.create(
            chat=self.chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=self.contact.id,
            text=text,
        )

    def outgoing(self, text, *, sent_by_ai=False):
        return Message.objects.create(
            chat=self.chat,
            sender_type=MessageSenderType.USER,
            sender_id=self.user.id,
            text=text,
            status=MessageStatus.SENT,
            sent_by_ai=sent_by_ai,
        )

    def test_signal_enqueues_human_messages_and_skips_ai_messages(self):
        incoming = self.incoming('Здравствуйте')
        outgoing = self.outgoing('Добрый день')
        Message.objects.create(
            chat=self.chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=self.contact.id,
            text='AI echo',
            sent_by_ai=True,
        )

        events = list(AIAutomationEvent.objects.all())

        self.assertEqual(len(events), 2)
        self.assertEqual(
            {event.message_id for event in events},
            {incoming.id, outgoing.id},
        )

    def test_signal_does_not_enqueue_without_authorized_workspace_user(self):
        self.user.is_active = False
        self.user.save(update_fields=('is_active', 'updated_at'))

        message = self.incoming('Сообщение после деактивации пользователя.')

        self.assertFalse(
            AIAutomationEvent.objects.filter(message=message).exists(),
        )

    def test_processing_stops_if_workspace_loses_authorized_user(self):
        message = self.incoming('Сообщение до деактивации пользователя.')
        event = message.ai_automation_event
        self.user.is_active = False
        self.user.save(update_fields=('is_active', 'updated_at'))
        analyzer = DummyAnalyzer({'contact': {'confidence': 1, 'fields': {}}})

        outcome = process_automation_event(event.id, analyzer=analyzer)

        self.assertEqual(outcome, 'ignored')
        self.assertEqual(analyzer.calls, [])
        event.refresh_from_db()
        self.assertEqual(event.status, AutomationEventStatus.IGNORED)
        self.assertFalse(AIProcessedEvent.objects.filter(event=event).exists())
        self.assertFalse(
            AIAutomationAuditLog.objects.filter(correlation_id=event.id).exists(),
        )

    def test_manager_message_runs_only_sender_eligible_actions(self):
        for index in range(5):
            self.incoming(f'Контекст клиента {index}')
        message = self.outgoing(
            'Клиент хочет купить внедрение, договорились созвониться.',
        )
        analyzer = DummyAnalyzer({
            'contact': {
                'confidence': 0.95,
                'fields': {'company': 'Не обновлять из сообщения менеджера'},
            },
            'deal': {
                'interest_confidence': 0.9,
                'confidence': 0.95,
                'create': True,
                'name': 'Внедрение из диалога',
                'fields': {'comment': 'Не применять как обогащение'},
            },
            'task': {
                'confidence': 0.9,
                'create': True,
                'title': 'Созвониться с клиентом',
            },
            'insight': {
                'summary': 'Менеджер подтвердил интерес клиента.',
                'confidence': 0.9,
            },
        })

        outcome = process_automation_event(
            message.ai_automation_event.id,
            analyzer=analyzer,
        )

        self.assertEqual(outcome, 'completed')
        self.contact.refresh_from_db()
        self.assertIsNone(self.contact.company)
        deal = Deal.objects.get()
        self.assertEqual(deal.name, 'Внедрение из диалога')
        self.assertEqual(Task.objects.get().deal, deal)
        insight = AIChatInsight.objects.get(source_message=message)
        self.assertEqual(
            insight.summary,
            'Менеджер подтвердил интерес клиента.',
        )
        action_results = {
            item.action_type: item.result
            for item in AIProcessedEvent.objects.filter(
                event=message.ai_automation_event,
            )
        }
        self.assertEqual(
            action_results[AutomationActionType.CONTACT_ENRICHMENT]['status'],
            'skipped_sender_not_eligible',
        )
        self.assertEqual(
            action_results[AutomationActionType.DEAL_ENRICHMENT]['status'],
            'skipped_sender_not_eligible',
        )
        self.assertEqual(
            action_results[AutomationActionType.DEAL_CREATE]['status'],
            'created',
        )
        self.assertEqual(
            action_results[AutomationActionType.TASK_CREATE]['status'],
            'created',
        )
        self.assertEqual(
            action_results[AutomationActionType.INSIGHT]['status'],
            'created',
        )

    def test_process_creates_deal_task_and_enriches_contact(self):
        message = self.incoming('Хочу купить внедрение, завтра созвон.')
        analyzer = DummyAnalyzer({
            'contact': {
                'confidence': 0.9,
                'fields': {
                    'company': 'ООО Ромашка',
                    'email': 'client@example.com',
                },
            },
            'deal': {
                'interest_confidence': 0.85,
                'create': True,
                'name': 'Внедрение AI Sales Manager',
                'amount': '120000',
                'comment': 'Интерес из Telegram',
            },
            'task': {
                'confidence': 0.9,
                'create': True,
                'title': 'Связаться с клиентом',
                'description': 'Обсудить внедрение',
            },
        })

        outcome = process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        self.assertEqual(outcome, 'completed')
        self.contact.refresh_from_db()
        self.assertEqual(self.contact.company, 'ООО Ромашка')
        self.assertEqual(self.contact.email, 'client@example.com')
        deal = Deal.objects.get(workspace=self.workspace, contact=self.contact)
        self.assertEqual(deal.name, 'Внедрение AI Sales Manager')
        self.assertEqual(
            DealHistory.objects.get(deal=deal).changed_by_type,
            ChangedByType.AI,
        )
        self.assertIsNotNone(self.contact.last_ai_deal_created_at)
        task = Task.objects.get(workspace=self.workspace, contact=self.contact)
        self.assertEqual(task.title, 'Связаться с клиентом')
        self.assertEqual(task.deal_id, deal.id)
        self.assertTrue(task.created_by_ai)
        self.assertEqual(task.source_chat, self.chat)
        self.assertEqual(task.comment, 'Создана AI из чата')
        usage = AIUsageDaily.objects.get(workspace=self.workspace)
        self.assertEqual(usage.deals_created, 1)
        self.assertEqual(usage.tasks_created, 1)
        self.assertEqual(usage.contacts_updated, 1)
        self.assertEqual(len(analyzer.calls[0]['context_messages']), 1)

    def test_enrichment_updates_only_empty_fields_and_uses_ai_audit_metadata(self):
        self.contact.company = 'Компания пользователя'
        self.contact.email = 'owner-filled@example.com'
        self.contact.save(update_fields=('company', 'email', 'updated_at'))
        stage = SalesStage.objects.get(workspace=self.workspace, is_system=True)
        deal = Deal.objects.create(
            workspace=self.workspace,
            stage=stage,
            contact=self.contact,
            name='Существующая сделка',
            amount='50000.00',
        )
        message = self.incoming('Наш телефон +7 999 123-45-67, бюджет 120000.')
        analyzer = DummyAnalyzer({
            'contact': {
                'confidence': 0.95,
                'fields': {
                    'company': 'Не перезаписывать',
                    'email': 'do-not-overwrite@example.com',
                    'phone': '+79991234567',
                },
            },
            'deal': {
                'confidence': 0.95,
                'fields': {
                    'amount': '120000',
                    'comment': 'Бюджет подтверждён клиентом',
                },
            },
        })

        process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        self.contact.refresh_from_db()
        deal.refresh_from_db()
        self.assertEqual(self.contact.company, 'Компания пользователя')
        self.assertEqual(self.contact.email, 'owner-filled@example.com')
        self.assertEqual(self.contact.phone, '+79991234567')
        self.assertEqual(deal.amount, Decimal('50000.00'))
        self.assertEqual(deal.comment, 'Бюджет подтверждён клиентом')
        contact_audit = ContactAuditLog.objects.get(
            contact_identifier=self.contact.id,
        )
        self.assertEqual(contact_audit.changes['source'], 'ai')
        self.assertEqual(contact_audit.changes['trigger'], 'data_enrichment')
        self.assertNotIn('company', contact_audit.changes)
        self.assertNotIn('email', contact_audit.changes)
        contact_log = AIAutomationAuditLog.objects.get(
            message=message,
            action_type=AutomationActionType.CONTACT_ENRICHMENT,
        )
        deal_log = AIAutomationAuditLog.objects.get(
            message=message,
            action_type=AutomationActionType.DEAL_ENRICHMENT,
        )
        self.assertEqual(contact_log.trigger, 'data_enrichment')
        self.assertEqual(deal_log.trigger, 'data_enrichment')
        self.assertEqual(contact_log.details['source'], 'ai')
        self.assertEqual(deal_log.details['source'], 'ai')

    def test_contact_and_deal_enrichment_share_daily_update_limit(self):
        AIUsageDaily.objects.create(
            workspace=self.workspace,
            date=timezone.now().date(),
            contacts_updated=49,
        )
        stage = SalesStage.objects.get(workspace=self.workspace, is_system=True)
        deal = Deal.objects.create(
            workspace=self.workspace,
            stage=stage,
            contact=self.contact,
            name='Лимитная сделка',
        )
        message = self.incoming('Компания Ромашка, бюджет 120000.')
        analyzer = DummyAnalyzer({
            'contact': {
                'confidence': 0.95,
                'fields': {'company': 'ООО Ромашка'},
            },
            'deal': {
                'confidence': 0.95,
                'fields': {'amount': '120000'},
            },
        })

        process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        self.contact.refresh_from_db()
        deal.refresh_from_db()
        usage = AIUsageDaily.objects.get(workspace=self.workspace)
        self.assertEqual(self.contact.company, 'ООО Ромашка')
        self.assertIsNone(deal.amount)
        self.assertEqual(usage.contacts_updated, 50)
        deal_action = AIProcessedEvent.objects.get(
            event=message.ai_automation_event,
            action_type=AutomationActionType.DEAL_ENRICHMENT,
        )
        self.assertEqual(deal_action.result['status'], 'skipped_daily_limit')
        limit_log = AIAutomationAuditLog.objects.get(
            message=message,
            action_type=AutomationActionType.DEAL_ENRICHMENT,
        )
        self.assertEqual(limit_log.action, AIAutomationAuditAction.AI_LIMIT_REACHED)
        self.assertEqual(limit_log.trigger, 'data_enrichment')

    def test_repeat_processing_is_idempotent(self):
        message = self.incoming('Нужна цена и напоминание.')
        analyzer = DummyAnalyzer({
            'deal': {
                'interest_confidence': 0.9,
                'create': True,
                'name': 'Новая заявка',
            },
            'task': {
                'confidence': 0.9,
                'create': True,
                'title': 'Подготовить предложение',
            },
        })
        event = message.ai_automation_event
        process_automation_event(event.id, analyzer=analyzer)
        AIAutomationEvent.objects.filter(id=event.id).update(
            status=AutomationEventStatus.PENDING,
            processed_at=None,
            available_at=timezone.now() - timedelta(seconds=1),
        )

        process_automation_event(event.id, analyzer=analyzer)

        self.assertEqual(Deal.objects.count(), 1)
        self.assertEqual(Task.objects.count(), 1)

    def test_recent_ai_deal_timestamp_blocks_duplicate_deal_creation(self):
        self.contact.last_ai_deal_created_at = timezone.now() - timedelta(hours=1)
        self.contact.save(update_fields=('last_ai_deal_created_at', 'updated_at'))
        message = self.incoming('Хочу купить ещё один проект.')
        analyzer = DummyAnalyzer({
            'deal': {
                'interest_confidence': 0.95,
                'create': True,
                'name': 'Повторная заявка',
            },
        })

        outcome = process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        self.assertEqual(outcome, 'completed')
        self.assertFalse(Deal.objects.exists())
        action = AIProcessedEvent.objects.get(
            event=message.ai_automation_event,
            action_type=AutomationActionType.DEAL_CREATE,
        )
        self.assertEqual(action.result['status'], 'skipped_recent_ai_deal')

    def test_non_final_deal_blocks_ai_deal_creation(self):
        stage = SalesStage.objects.get(workspace=self.workspace, is_system=True)
        existing = Deal.objects.create(
            workspace=self.workspace,
            stage=stage,
            contact=self.contact,
            name='Активная сделка',
        )
        message = self.incoming('Хочу купить ещё один продукт.')
        analyzer = DummyAnalyzer({
            'deal': {
                'interest_confidence': 0.95,
                'create': True,
                'name': 'Новая заявка',
            },
        })

        process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        self.assertEqual(list(Deal.objects.all()), [existing])
        action = AIProcessedEvent.objects.get(
            event=message.ai_automation_event,
            action_type=AutomationActionType.DEAL_CREATE,
        )
        self.assertEqual(action.result['status'], 'skipped_active_deal_exists')

    def test_final_deal_does_not_block_ai_deal_creation(self):
        final_stage = SalesStage.objects.create(
            workspace=self.workspace,
            name='Закрыто успешно',
            is_final=True,
            order=2,
        )
        closed = Deal.objects.create(
            workspace=self.workspace,
            stage=final_stage,
            contact=self.contact,
            name='Завершённая сделка',
        )
        message = self.incoming('Хочу купить новый продукт.')
        analyzer = DummyAnalyzer({
            'deal': {
                'interest_confidence': 0.95,
                'create': True,
                'name': 'Новый интерес',
            },
        })

        process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        created = Deal.objects.exclude(id=closed.id).get()
        self.assertTrue(created.stage.is_system)
        action = AIProcessedEvent.objects.get(
            event=message.ai_automation_event,
            action_type=AutomationActionType.DEAL_CREATE,
        )
        self.assertEqual(action.result['status'], 'created')

    def test_daily_limits_skip_mutations(self):
        AIUsageDaily.objects.create(
            workspace=self.workspace,
            date=timezone.now().date(),
            deals_created=50,
            tasks_created=100,
            contacts_updated=50,
        )
        message = self.incoming('Куплю, и надо перезвонить.')
        analyzer = DummyAnalyzer({
            'contact': {
                'confidence': 0.9,
                'fields': {'company': 'ООО Лимит'},
            },
            'deal': {
                'interest_confidence': 0.9,
                'create': True,
                'name': 'Лимитная заявка',
            },
            'task': {
                'confidence': 0.9,
                'create': True,
                'title': 'Перезвонить',
            },
        })

        process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        self.contact.refresh_from_db()
        self.assertIsNone(self.contact.company)
        self.assertFalse(Deal.objects.exists())
        self.assertFalse(Task.objects.exists())

    def test_task_creation_respects_chat_24h_limit(self):
        for index in range(5):
            task = Task.objects.create(
                workspace=self.workspace,
                contact=self.contact,
                source_chat=self.chat,
                title=f'AI задача {index}',
                created_by_ai=True,
                comment='Создана AI из чата',
            )
            Task.objects.filter(id=task.id).update(
                created_at=timezone.now() - timedelta(hours=1),
            )
        message = self.incoming('Создай ещё задачу.')
        analyzer = DummyAnalyzer({
            'task': {
                'confidence': 0.9,
                'create': True,
                'title': 'Шестая задача',
            },
        })

        process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        self.assertEqual(Task.objects.count(), 5)
        task_action = AIProcessedEvent.objects.get(
            event=message.ai_automation_event,
            action_type=AutomationActionType.TASK_CREATE,
        )
        self.assertEqual(task_action.result['status'], 'skipped_chat_limit')

    def test_task_limit_is_scoped_to_source_chat(self):
        old_chat = Chat.objects.create(
            workspace=self.workspace,
            contact=self.contact,
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        for index in range(5):
            task = Task.objects.create(
                workspace=self.workspace,
                contact=self.contact,
                source_chat=old_chat,
                title=f'Задача старого чата {index}',
                created_by_ai=True,
            )
            Task.objects.filter(id=task.id).update(
                created_at=timezone.now() - timedelta(hours=1),
            )
        message = self.incoming('Напомните связаться со мной.')
        analyzer = DummyAnalyzer({
            'task': {
                'confidence': 0.95,
                'create': True,
                'title': 'Связаться с клиентом',
            },
        })

        process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        created = Task.objects.get(source_chat=self.chat)
        self.assertEqual(created.title, 'Связаться с клиентом')
        self.assertEqual(Task.objects.count(), 6)

    def test_task_time_only_rolls_to_next_day_and_uses_commitment_audit(self):
        self.workspace.timezone = 'UTC'
        self.workspace.save(update_fields=('timezone', 'updated_at'))
        message = self.incoming('Позвоните в 00:00.')
        analyzer = DummyAnalyzer({
            'task': {
                'confidence': 0.95,
                'create': True,
                'title': 'Позвонить клиенту',
                'description': 'К' * 600,
                'due_date': '00:00',
                'due_date_type': 'datetime',
            },
        })

        process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        task = Task.objects.get(source_chat=self.chat)
        local_due_date = task.due_date.astimezone(datetime_timezone.utc)
        self.assertEqual(
            local_due_date.date(),
            (timezone.now() + timedelta(days=1)).date(),
        )
        self.assertEqual((local_due_date.hour, local_due_date.minute), (0, 0))
        self.assertEqual(len(task.description), 500)
        history = task.history.get()
        self.assertEqual(history.source, TaskSource.AI)
        self.assertEqual(history.data['source_chat_id'], str(self.chat.id))
        audit = AIAutomationAuditLog.objects.get(
            message=message,
            action_type=AutomationActionType.TASK_CREATE,
        )
        self.assertEqual(audit.trigger, 'commitment_detected')
        self.assertEqual(audit.details['source'], 'ai')

    def test_recent_same_chat_ai_task_is_skipped_as_duplicate(self):
        Task.objects.create(
            workspace=self.workspace,
            contact=self.contact,
            source_chat=self.chat,
            title='Отправить договор',
            created_by_ai=True,
        )
        message = self.incoming('Напомните отправить договор.')
        analyzer = DummyAnalyzer({
            'task': {
                'confidence': 0.95,
                'create': True,
                'title': 'Отправить договор',
            },
        })

        process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        self.assertEqual(Task.objects.count(), 1)
        action = AIProcessedEvent.objects.get(
            event=message.ai_automation_event,
            action_type=AutomationActionType.TASK_CREATE,
        )
        self.assertEqual(action.result['status'], 'skipped_duplicate')

    def test_technical_error_is_rescheduled(self):
        message = self.incoming('Проверь retry.')
        analyzer = DummyAnalyzer(error=AutomationTechnicalError('timeout'))

        outcome = process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        event = AIAutomationEvent.objects.get(id=message.ai_automation_event.id)
        self.assertEqual(outcome, 'rescheduled')
        self.assertEqual(event.status, AutomationEventStatus.PENDING)
        self.assertEqual(event.attempts, 1)
        self.assertEqual(event.failure_type, AutomationFailureType.TECHNICAL)
        self.assertGreater(event.available_at, timezone.now())
        self.assertFalse(AIAutomationAuditLog.objects.exists())

    def test_business_error_fails_without_retry(self):
        message = self.incoming('Проверь business error.')
        analyzer = DummyAnalyzer(error=AutomationBusinessError('invalid json'))

        outcome = process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        event = AIAutomationEvent.objects.get(id=message.ai_automation_event.id)
        self.assertEqual(outcome, 'failed')
        self.assertEqual(event.status, AutomationEventStatus.FAILED)
        self.assertEqual(event.attempts, 1)
        self.assertEqual(event.failure_type, AutomationFailureType.BUSINESS)

        log = AIAutomationAuditLog.objects.get()
        self.assertEqual(log.action, AIAutomationAuditAction.AI_ACTION_FAILED)
        self.assertEqual(log.action_type, 'automation_failure')
        self.assertEqual(log.details['failure_type'], AutomationFailureType.BUSINESS)
        self.assertIn('invalid json', log.details['error'])
        self.assertEqual(log.message_id, message.id)
        notification = Notification.objects.get()
        self.assertEqual(notification.type, NotificationType.AI_ACTION_FAILED)
        self.assertEqual(notification.entity_type, 'chat')
        self.assertEqual(notification.entity_id, str(self.chat.id))
        self.assertEqual(notification.link, f'/chat/{self.chat.id}')
        self.assertIn('invalid json', notification.content)

    def test_final_technical_error_is_audited_after_retries(self):
        message = self.incoming('Проверь final technical error.')
        event_id = message.ai_automation_event.id
        AIAutomationEvent.objects.filter(id=event_id).update(attempts=3)
        analyzer = DummyAnalyzer(error=AutomationTechnicalError('timeout'))

        outcome = process_automation_event(event_id, analyzer=analyzer)

        event = AIAutomationEvent.objects.get(id=event_id)
        self.assertEqual(outcome, 'failed')
        self.assertEqual(event.status, AutomationEventStatus.FAILED)
        self.assertEqual(event.attempts, 4)
        self.assertEqual(event.failure_type, AutomationFailureType.TECHNICAL)

        log = AIAutomationAuditLog.objects.get()
        self.assertEqual(log.action, AIAutomationAuditAction.AI_ACTION_FAILED)
        self.assertEqual(log.action_type, 'automation_failure')
        self.assertEqual(log.details['failure_type'], AutomationFailureType.TECHNICAL)
        self.assertIn('timeout', log.details['error'])
        self.assertEqual(log.message_id, message.id)
        notification = Notification.objects.get()
        self.assertEqual(notification.type, NotificationType.AI_ACTION_FAILED)
        self.assertIn('timeout', notification.content)

    def test_analysis_client_respects_workspace_ai_rate_limit(self):
        message = self.incoming('Проверь rate limit.')
        event = AIAutomationEvent.objects.get(message=message)
        client = FakeCompletionClient()
        analyzer = AutomationAnalysisClient(chat_client=client)

        with patch.dict(AI_LIMITS, {'workspace_ai_requests_per_minute': 1}):
            self.assertEqual(
                analyzer.analyze(event=event, context_messages=[]),
                {},
            )
            with self.assertRaisesMessage(
                AutomationTechnicalError,
                'ai_rate_limit_exceeded',
            ):
                analyzer.analyze(event=event, context_messages=[])

        self.assertEqual(client.calls, 1)

    def test_context_uses_last_five_messages(self):
        messages = [self.incoming(f'Сообщение {index}') for index in range(6)]
        base_time = timezone.now() - timedelta(minutes=10)
        for index, message in enumerate(messages):
            Message.objects.filter(id=message.id).update(
                created_at=base_time + timedelta(seconds=index),
            )
        analyzer = DummyAnalyzer({})

        process_automation_event(messages[-1].ai_automation_event.id, analyzer=analyzer)

        context = analyzer.calls[0]['context_messages']
        self.assertEqual(len(context), 5)
        self.assertEqual(context[-1]['id'], str(messages[-1].id))

    def test_chat_analysis_throttle_reschedules_next_event(self):
        first = self.incoming('Первое сообщение.')
        second = self.incoming('Второе сообщение.')
        analyzer = DummyAnalyzer({})
        process_automation_event(first.ai_automation_event.id, analyzer=analyzer)

        outcome = process_automation_event(second.ai_automation_event.id, analyzer=analyzer)

        second_event = AIAutomationEvent.objects.get(id=second.ai_automation_event.id)
        self.assertEqual(outcome, 'rescheduled')
        self.assertEqual(second_event.status, AutomationEventStatus.PENDING)
        self.assertGreater(second_event.available_at, timezone.now())

    def test_insight_is_created_every_five_contact_messages(self):
        messages = [self.incoming(f'Сообщение {index}') for index in range(5)]
        analyzer = DummyAnalyzer({
            'insight': {
                'summary': 'Клиент активно интересуется покупкой.',
                'sentiment': 'positive',
                'objections': ['Цена'],
                'recommendations': ['Отправить КП'],
            },
        })

        process_automation_event(messages[-1].ai_automation_event.id, analyzer=analyzer)

        insight = AIChatInsight.objects.get()
        self.assertEqual(insight.message_count, 5)
        self.assertEqual(insight.summary, 'Клиент активно интересуется покупкой.')
        self.assertEqual(insight.objections, ['Цена'])

    def test_structured_insights_are_saved_to_contact_and_deal(self):
        stage = SalesStage.objects.get(workspace=self.workspace, is_system=True)
        deal = Deal.objects.create(
            workspace=self.workspace,
            stage=stage,
            contact=self.contact,
            name='Текущая сделка',
        )
        messages = [self.incoming(f'Сообщение {index}') for index in range(5)]
        analyzer = DummyAnalyzer({
            'insight': {
                'summary': 'Клиенту нужна CRM для отдела продаж.',
                'needs': 'CRM для отдела продаж',
                'budget': '120000 RUB',
                'timeline': 'в течение месяца',
                'objections': ['Нужно согласовать бюджет'],
                'next_step': 'Отправить коммерческое предложение',
                'probability': 72,
                'confidence': 0.86,
            },
        })

        process_automation_event(messages[-1].ai_automation_event.id, analyzer=analyzer)

        self.contact.refresh_from_db()
        deal.refresh_from_db()
        self.assertEqual(self.contact.ai_insights['needs'], 'CRM для отдела продаж')
        self.assertEqual(self.contact.ai_insights['probability'], 72)
        self.assertEqual(self.contact.ai_insights['confidence'], 0.86)
        self.assertIsNotNone(self.contact.ai_insights['last_analyzed_at'])
        self.assertEqual(deal.ai_insights['budget'], '120000 RUB')
        action = AIProcessedEvent.objects.get(
            event=messages[-1].ai_automation_event,
            action_type=AutomationActionType.INSIGHT,
        )
        self.assertIn('structured', action.result)
        self.assertIn('contact', action.result['structured']['changes'])

    def test_insight_counter_includes_manager_messages_and_resets(self):
        first_batch = [
            self.incoming('Сообщение клиента 1'),
            self.outgoing('Ответ менеджера 1'),
            self.incoming('Сообщение клиента 2'),
            self.outgoing('Ответ менеджера 2'),
            self.incoming('Сообщение клиента 3'),
        ]
        analyzer = DummyAnalyzer({
            'insight': {
                'summary': 'Сводка пяти сообщений.',
                'needs': 'Автоматизация продаж',
                'confidence': 0.8,
            },
        })

        process_automation_event(
            first_batch[-1].ai_automation_event.id,
            analyzer=analyzer,
        )

        first_insight = AIChatInsight.objects.get()
        self.assertEqual(first_insight.message_count, 5)
        AIAutomationEvent.objects.filter(
            id=first_batch[-1].ai_automation_event.id,
        ).update(processed_at=timezone.now() - timedelta(seconds=10))

        second_batch = [
            self.outgoing('Ответ менеджера 3'),
            self.incoming('Сообщение клиента 4'),
            self.outgoing('Ответ менеджера 4'),
            self.incoming('Сообщение клиента 5'),
        ]
        process_automation_event(
            second_batch[-1].ai_automation_event.id,
            analyzer=analyzer,
        )
        self.assertEqual(AIChatInsight.objects.count(), 1)
        AIAutomationEvent.objects.filter(
            id=second_batch[-1].ai_automation_event.id,
        ).update(processed_at=timezone.now() - timedelta(seconds=10))

        tenth_message = self.outgoing('Ответ менеджера 5')
        process_automation_event(
            tenth_message.ai_automation_event.id,
            analyzer=analyzer,
        )

        self.assertEqual(AIChatInsight.objects.count(), 2)
        newest = AIChatInsight.objects.order_by('-created_at').first()
        self.assertEqual(newest.message_count, 10)

    def test_newer_lower_confidence_insight_updates_with_audit_reason(self):
        old_analyzed_at = timezone.now() - timedelta(days=1)
        self.contact.ai_insights = {
            'needs': 'Ручной учёт продаж',
            'confidence': 0.9,
            'last_analyzed_at': old_analyzed_at.isoformat(),
        }
        self.contact.save(update_fields=('ai_insights', 'updated_at'))
        stage = SalesStage.objects.get(workspace=self.workspace, is_system=True)
        deal = Deal.objects.create(
            workspace=self.workspace,
            stage=stage,
            contact=self.contact,
            name='Сделка для аналитики',
            ai_insights={
                'needs': 'Ручной учёт продаж',
                'confidence': 0.9,
                'last_analyzed_at': old_analyzed_at.isoformat(),
            },
        )
        messages = [self.incoming(f'Новый контекст {index}') for index in range(5)]
        analyzer = DummyAnalyzer({
            'insight': {
                'summary': 'Потребность уточнена.',
                'needs': 'CRM с автоматизацией',
                'confidence': 0.7,
            },
        })

        process_automation_event(messages[-1].ai_automation_event.id, analyzer=analyzer)

        self.contact.refresh_from_db()
        deal.refresh_from_db()
        self.assertEqual(self.contact.ai_insights['needs'], 'CRM с автоматизацией')
        self.assertEqual(deal.ai_insights['needs'], 'CRM с автоматизацией')
        audit = AIAutomationAuditLog.objects.get(
            message=messages[-1],
            action_type=AutomationActionType.INSIGHT,
        )
        self.assertEqual(audit.action, AIAutomationAuditAction.AI_INSIGHTS_EXTRACTED)
        self.assertEqual(audit.confidence, 0.7)
        need_change = audit.details['structured']['changes']['contact']['needs']
        self.assertEqual(need_change['old'], 'Ручной учёт продаж')
        self.assertEqual(need_change['new'], 'CRM с автоматизацией')
        self.assertEqual(need_change['reason'], 'newer_analysis')

    def test_older_insight_requires_higher_confidence(self):
        current_analyzed_at = timezone.now()
        self.contact.ai_insights = {
            'needs': 'Текущее значение',
            'confidence': 0.8,
            'last_analyzed_at': current_analyzed_at.isoformat(),
        }
        self.contact.save(update_fields=('ai_insights', 'updated_at'))

        skipped = apply_structured_insights(
            contact=self.contact,
            insight_data={
                'needs': 'Старое значение с низкой уверенностью',
                'confidence': 0.7,
            },
            analyzed_at=current_analyzed_at - timedelta(hours=1),
        )
        updated = apply_structured_insights(
            contact=self.contact,
            insight_data={
                'needs': 'Старое значение с высокой уверенностью',
                'confidence': 0.95,
            },
            analyzed_at=current_analyzed_at - timedelta(minutes=30),
        )

        self.contact.refresh_from_db()
        self.assertEqual(skipped['status'], 'skipped_no_changes')
        self.assertEqual(updated['status'], 'updated')
        self.assertEqual(
            self.contact.ai_insights['needs'],
            'Старое значение с высокой уверенностью',
        )
        self.assertEqual(
            self.contact.ai_insights['last_analyzed_at'],
            current_analyzed_at.isoformat(),
        )
        self.assertEqual(
            updated['changes']['contact']['needs']['reason'],
            'higher_confidence',
        )
