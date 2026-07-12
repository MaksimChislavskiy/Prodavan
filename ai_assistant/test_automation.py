from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from contacts.models import Contact
from deals.models import ChangedByType, Deal, DealHistory, SalesStage
from messaging.models import Chat, Message, MessageSenderType, MessageStatus
from tasks.models import Task
from users.models import User

from .automation import (
    AutomationBusinessError,
    AutomationTechnicalError,
    process_automation_event,
)
from .models import (
    AIChatInsight,
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


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    AI_AUTOMATION_CONFIDENCE_THRESHOLD=0.7,
)
class AIAutomationTests(TestCase):
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

    def test_signal_enqueues_only_contact_messages(self):
        incoming = self.incoming('Здравствуйте')
        self.outgoing('Добрый день')
        Message.objects.create(
            chat=self.chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=self.contact.id,
            text='AI echo',
            sent_by_ai=True,
        )

        events = list(AIAutomationEvent.objects.all())

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].message_id, incoming.id)

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
        self.assertEqual(task.comment, 'Создана AI из чата')
        usage = AIUsageDaily.objects.get(workspace=self.workspace)
        self.assertEqual(usage.deals_created, 1)
        self.assertEqual(usage.tasks_created, 1)
        self.assertEqual(usage.contacts_updated, 1)
        self.assertEqual(len(analyzer.calls[0]['context_messages']), 1)

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

    def test_business_error_fails_without_retry(self):
        message = self.incoming('Проверь business error.')
        analyzer = DummyAnalyzer(error=AutomationBusinessError('invalid json'))

        outcome = process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        event = AIAutomationEvent.objects.get(id=message.ai_automation_event.id)
        self.assertEqual(outcome, 'failed')
        self.assertEqual(event.status, AutomationEventStatus.FAILED)
        self.assertEqual(event.attempts, 1)
        self.assertEqual(event.failure_type, AutomationFailureType.BUSINESS)

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
