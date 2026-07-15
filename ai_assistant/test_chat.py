import uuid
from datetime import timedelta
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from deals.models import Deal, SalesStage
from messaging.models import Chat, Message, MessageSenderType, MessageStatus
from notifications.models import Notification, NotificationType
from tasks.models import DueDateType, Task, TaskStatus
from users.models import User

from .chat_client import (
    ChatCompletionClient,
    ChatCompletionResult,
    ChatTimeoutError,
    sanitize_ai_content,
)
from .limits import AI_LIMITS
from .models import (
    AIChatMessage,
    AIChatMessageStatus,
    AIChatRole,
    AIChatSession,
    AIChatSessionStatus,
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeDocumentStatus,
)
from .retrieval import RetrievedChunk, retrieve_knowledge


class FakeEmbeddingClient:
    def create_embeddings(self, texts):
        return [[1.0, 0.0] for _ in texts]


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


class TimeoutCompletionClient:
    def complete(self, messages):
        raise ChatTimeoutError


def retrieved_source(text='Компания работает ежедневно.'):
    return RetrievedChunk(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_name='Регламент.txt',
        position=0,
        text=text,
        score=0.95,
    )


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    AI_CHAT_MAX_CONTEXT_TOKENS=20_000,
    AI_CHAT_RETRIEVAL_LIMIT=5,
    AI_RETRIEVAL_MIN_SCORE=0.2,
)
class AIChatApiTests(TestCase):
    session_url = '/api/ai/chat/session'
    sessions_url = '/api/ai/chat/sessions'
    chat_url = '/api/ai/chat'
    retry_url = '/api/ai/chat/retry'
    history_url = '/api/ai/chat/history'
    login_url = '/api/auth/login'

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

    def _login(self, email='owner@example.com', password='StrongPass1'):
        response = self.client.post(
            self.login_url,
            {'email': email, 'password': password},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data['access_token']

    @staticmethod
    def _auth(access):
        return {'HTTP_AUTHORIZATION': f'Bearer {access}'}

    def _session(self, **overrides):
        defaults = {
            'workspace': self.user.workspace,
            'user': self.user,
        }
        defaults.update(overrides)
        return AIChatSession.objects.create(**defaults)

    def _payload(self, session, **overrides):
        payload = {
            'client_message_id': str(uuid.uuid4()),
            'message': 'Когда работает компания?',
            'context': {'page': 'dashboard', 'entity_id': None},
            'session_id': str(session.id),
        }
        payload.update(overrides)
        return payload

    def _message(self, session, **overrides):
        defaults = {
            'session': session,
            'workspace': session.workspace,
            'user': session.user,
            'role': AIChatRole.USER,
            'content': 'Вопрос',
            'status': AIChatMessageStatus.SUCCESS,
            'client_message_id': uuid.uuid4(),
        }
        defaults.update(overrides)
        return AIChatMessage.objects.create(**defaults)

    def test_chat_endpoints_require_authentication(self):
        self.assertEqual(
            self.client.post(self.session_url, {}, format='json').status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(
            self.client.get(self.history_url).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_create_session_accepts_optional_context(self):
        access = self._login()

        response = self.client.post(
            self.session_url,
            {'context': {'page': 'contacts', 'entity_id': None}},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        session = AIChatSession.objects.get(id=response.data['session_id'])
        self.assertEqual(session.context_page, 'contacts')
        self.assertEqual(session.message_count, 0)

    def test_foreign_deal_context_is_hidden_on_session_creation(self):
        other = User.objects.create_user(
            email='deal-context-other@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        other_stage = SalesStage.objects.get(
            workspace=other.workspace,
            is_system=True,
        )
        foreign_deal = Deal.objects.create(
            workspace=other.workspace,
            stage=other_stage,
            name='Чужая сделка',
        )
        access = self._login()

        response = self.client.post(
            self.session_url,
            {
                'context': {
                    'page': 'deals',
                    'entity_id': str(foreign_deal.id),
                },
            },
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data['error']['code'],
            'CONTEXT_ENTITY_NOT_FOUND',
        )
        self.assertFalse(
            AIChatSession.objects.filter(workspace=self.user.workspace).exists(),
        )

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_deal_context_is_included_in_model_prompt(
        self,
        client_class,
        retrieve,
    ):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Анна Клиентова',
            company='ООО Ромашка',
            phone='+79991234567',
            email='anna@example.com',
            telegram='@anna_client',
        )
        stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
        )
        deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=stage,
            contact=contact,
            name='Внедрение CRM',
            amount='150000.00',
        )
        session = self._session()
        fake_client = FakeCompletionClient()
        client_class.return_value = fake_client
        retrieve.return_value = []
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(
                session,
                context={'page': 'deals', 'entity_id': str(deal.id)},
            ),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        system_prompt = fake_client.messages[0]['content']
        self.assertIn('Данные CRM-контекста (JSON)', system_prompt)
        self.assertIn(str(deal.id), system_prompt)
        self.assertIn('Внедрение CRM', system_prompt)
        self.assertIn('Новый лид', system_prompt)
        self.assertIn('150000.00', system_prompt)
        self.assertIn('Анна Клиентова', system_prompt)
        self.assertIn('anna@example.com', system_prompt)
        client_class.assert_called_once()

    def test_deleted_deal_context_is_rejected_before_saving_messages(self):
        stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
        )
        deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=stage,
            name='Удалённая сделка',
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        session = self._session()
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(
                session,
                context={'page': 'deals', 'entity_id': str(deal.id)},
            ),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data['error']['code'],
            'CONTEXT_ENTITY_NOT_FOUND',
        )
        self.assertFalse(AIChatMessage.objects.exists())

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_contact_context_includes_card_and_related_active_deals(
        self,
        client_class,
        retrieve,
    ):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Мария Соколова',
            company='ООО Вектор',
            phone='+79990001122',
            email='maria@example.com',
            telegram='@maria_sokolova',
            comment='Предпочитает общение в Telegram',
            ai_insights={
                'needs': 'Автоматизация продаж',
                'probability': 75,
            },
        )
        stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
        )
        active_deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=stage,
            contact=contact,
            name='Лицензии для отдела продаж',
            amount='275000.00',
        )
        Deal.objects.create(
            workspace=self.user.workspace,
            stage=stage,
            contact=contact,
            name='Удалённая связанная сделка',
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        session = self._session()
        fake_client = FakeCompletionClient()
        client_class.return_value = fake_client
        retrieve.return_value = []
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(
                session,
                context={'page': 'contacts', 'entity_id': str(contact.id)},
            ),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        system_prompt = fake_client.messages[0]['content']
        self.assertIn(str(contact.id), system_prompt)
        self.assertIn('Мария Соколова', system_prompt)
        self.assertIn('ООО Вектор', system_prompt)
        self.assertIn('maria@example.com', system_prompt)
        self.assertIn('Автоматизация продаж', system_prompt)
        self.assertIn(str(active_deal.id), system_prompt)
        self.assertIn('Лицензии для отдела продаж', system_prompt)
        self.assertIn('275000.00', system_prompt)
        self.assertNotIn('Удалённая связанная сделка', system_prompt)
        client_class.assert_called_once()

    def test_foreign_contact_context_is_hidden_on_session_creation(self):
        other = User.objects.create_user(
            email='contact-context-other@example.com',
            password='StrongPass2',
            first_name='Анна',
            last_name='Петрова',
            is_confirmed=True,
        )
        foreign_contact = Contact.objects.create(
            workspace=other.workspace,
            name='Чужой контакт',
        )
        access = self._login()

        response = self.client.post(
            self.session_url,
            {
                'context': {
                    'page': 'contacts',
                    'entity_id': str(foreign_contact.id),
                },
            },
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data['error']['code'],
            'CONTEXT_ENTITY_NOT_FOUND',
        )
        self.assertFalse(
            AIChatSession.objects.filter(workspace=self.user.workspace).exists(),
        )

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_task_context_includes_description_and_related_objects(
        self,
        client_class,
        retrieve,
    ):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Сергей Волков',
            company='ООО Горизонт',
            email='sergey@example.com',
        )
        stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
        )
        deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=stage,
            contact=contact,
            name='Поставка оборудования',
            amount='480000.00',
        )
        due_date = timezone.now() + timedelta(days=2)
        task = Task.objects.create(
            workspace=self.user.workspace,
            title='Подготовить коммерческое предложение',
            description='Рассчитать стоимость для двадцати рабочих мест',
            due_date=due_date,
            due_date_type=DueDateType.DATETIME,
            status=TaskStatus.IN_PROGRESS,
            contact=contact,
            deal=deal,
            comment='Согласовать скидку с руководителем',
            created_by_user=self.user,
        )
        session = self._session()
        fake_client = FakeCompletionClient()
        client_class.return_value = fake_client
        retrieve.return_value = []
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(
                session,
                context={'page': 'tasks', 'entity_id': str(task.id)},
            ),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        system_prompt = fake_client.messages[0]['content']
        self.assertIn(str(task.id), system_prompt)
        self.assertIn('Подготовить коммерческое предложение', system_prompt)
        self.assertIn(
            'Рассчитать стоимость для двадцати рабочих мест',
            system_prompt,
        )
        self.assertIn('in_progress', system_prompt)
        self.assertIn(due_date.isoformat(), system_prompt)
        self.assertIn('Согласовать скидку с руководителем', system_prompt)
        self.assertIn('Сергей Волков', system_prompt)
        self.assertIn('sergey@example.com', system_prompt)
        self.assertIn('Поставка оборудования', system_prompt)
        self.assertIn('480000.00', system_prompt)
        client_class.assert_called_once()

    def test_deleted_task_context_is_rejected_before_saving_messages(self):
        task = Task.objects.create(
            workspace=self.user.workspace,
            title='Удалённая задача',
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        session = self._session()
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(
                session,
                context={'page': 'tasks', 'entity_id': str(task.id)},
            ),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data['error']['code'],
            'CONTEXT_ENTITY_NOT_FOUND',
        )
        self.assertFalse(AIChatMessage.objects.exists())

    def test_foreign_task_context_is_hidden_on_session_creation(self):
        other = User.objects.create_user(
            email='task-context-other@example.com',
            password='StrongPass2',
            first_name='Олег',
            last_name='Петров',
            is_confirmed=True,
        )
        foreign_task = Task.objects.create(
            workspace=other.workspace,
            title='Чужая задача',
            created_by_user=other,
        )
        access = self._login()

        response = self.client.post(
            self.session_url,
            {
                'context': {
                    'page': 'tasks',
                    'entity_id': str(foreign_task.id),
                },
            },
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data['error']['code'],
            'CONTEXT_ENTITY_NOT_FOUND',
        )
        self.assertFalse(
            AIChatSession.objects.filter(workspace=self.user.workspace).exists(),
        )

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_chat_context_includes_contact_and_active_message_history(
        self,
        client_class,
        retrieve,
    ):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Елена Миронова',
            company='ООО Альфа',
            phone='+79995554433',
            telegram='@elena_mironova',
        )
        chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=contact,
            last_message='Отправьте договор, пожалуйста',
            last_message_at=timezone.now(),
            unread_count=1,
            ai_autopilot_enabled=False,
        )
        first = Message.objects.create(
            chat=chat,
            sender_type=MessageSenderType.USER,
            sender_id=self.user.id,
            text='Добрый день! Подготовили предложение.',
            status=MessageStatus.DELIVERED,
        )
        Message.objects.create(
            chat=chat,
            sender_type=MessageSenderType.USER,
            sender_id=self.user.id,
            text='Удалённое сообщение не для модели',
            status=MessageStatus.SENT,
            is_deleted=True,
        )
        last = Message.objects.create(
            chat=chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=contact.id,
            text='Отправьте договор, пожалуйста',
        )
        session = self._session()
        fake_client = FakeCompletionClient()
        client_class.return_value = fake_client
        retrieve.return_value = []
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(
                session,
                context={'page': 'chat', 'entity_id': str(chat.id)},
            ),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        system_prompt = fake_client.messages[0]['content']
        self.assertIn(str(chat.id), system_prompt)
        self.assertIn('Елена Миронова', system_prompt)
        self.assertIn('ООО Альфа', system_prompt)
        self.assertIn('@elena_mironova', system_prompt)
        self.assertIn(str(first.id), system_prompt)
        self.assertIn('Добрый день! Подготовили предложение.', system_prompt)
        self.assertIn(str(last.id), system_prompt)
        self.assertIn('Отправьте договор, пожалуйста', system_prompt)
        self.assertNotIn('Удалённое сообщение не для модели', system_prompt)
        history_start = system_prompt.index('"history":[')
        self.assertLess(
            system_prompt.index(
                'Добрый день! Подготовили предложение.',
                history_start,
            ),
            system_prompt.index(
                'Отправьте договор, пожалуйста',
                history_start,
            ),
        )
        client_class.assert_called_once()

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_chat_context_limits_history_and_reports_truncation(
        self,
        client_class,
        retrieve,
    ):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Контакт с длинной историей',
        )
        chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=contact,
        )
        for index in range(51):
            Message.objects.create(
                chat=chat,
                sender_type=MessageSenderType.CONTACT,
                sender_id=contact.id,
                text=f'Сообщение истории {index}',
            )
        session = self._session()
        fake_client = FakeCompletionClient()
        client_class.return_value = fake_client
        retrieve.return_value = []
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(
                session,
                context={'page': 'chat', 'entity_id': str(chat.id)},
            ),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        system_prompt = fake_client.messages[0]['content']
        self.assertIn('"message_count":51', system_prompt)
        self.assertIn('"history_included_count":50', system_prompt)
        self.assertIn('"history_truncated":true', system_prompt)
        self.assertNotIn('Сообщение истории 0', system_prompt)
        self.assertIn('Сообщение истории 50', system_prompt)

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_chat_context_limits_history_text_size(
        self,
        client_class,
        retrieve,
    ):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Контакт с длинным сообщением',
        )
        chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=contact,
        )
        Message.objects.create(
            chat=chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=contact.id,
            text=('x' * 20_100) + 'ХВОСТ_НЕ_ДОЛЖЕН_ПОПАСТЬ',
        )
        session = self._session()
        fake_client = FakeCompletionClient()
        client_class.return_value = fake_client
        retrieve.return_value = []
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(
                session,
                context={'page': 'chat', 'entity_id': str(chat.id)},
            ),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        system_prompt = fake_client.messages[0]['content']
        self.assertIn('"history_included_count":1', system_prompt)
        self.assertIn('"history_truncated":true', system_prompt)
        self.assertIn('"text_truncated":true', system_prompt)
        self.assertNotIn('ХВОСТ_НЕ_ДОЛЖЕН_ПОПАСТЬ', system_prompt)

    def test_deleted_chat_context_is_rejected_before_saving_messages(self):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Контакт удалённого чата',
        )
        chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=contact,
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        session = self._session()
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(
                session,
                context={'page': 'chat', 'entity_id': str(chat.id)},
            ),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data['error']['code'],
            'CONTEXT_ENTITY_NOT_FOUND',
        )
        self.assertFalse(AIChatMessage.objects.exists())

    def test_foreign_chat_context_is_hidden_on_session_creation(self):
        other = User.objects.create_user(
            email='chat-context-other@example.com',
            password='StrongPass2',
            first_name='Ирина',
            last_name='Петрова',
            is_confirmed=True,
        )
        contact = Contact.objects.create(
            workspace=other.workspace,
            name='Чужой собеседник',
        )
        foreign_chat = Chat.objects.create(
            workspace=other.workspace,
            contact=contact,
        )
        access = self._login()

        response = self.client.post(
            self.session_url,
            {
                'context': {
                    'page': 'chat',
                    'entity_id': str(foreign_chat.id),
                },
            },
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data['error']['code'],
            'CONTEXT_ENTITY_NOT_FOUND',
        )
        self.assertFalse(
            AIChatSession.objects.filter(workspace=self.user.workspace).exists(),
        )

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_send_uses_rag_saves_metrics_and_context(
        self,
        client_class,
        retrieve,
    ):
        session = self._session()
        fake_client = FakeCompletionClient()
        client_class.return_value = fake_client
        retrieve.return_value = [retrieved_source()]
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(session),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['message']['status'], 'success')
        self.assertEqual(response.data['message']['model_name'], 'test-model')
        self.assertEqual(response.data['message']['total_tokens'], 15)
        self.assertEqual(AIChatMessage.objects.count(), 2)
        session.refresh_from_db()
        self.assertEqual(session.context_page, 'dashboard')
        self.assertEqual(session.message_count, 2)
        system_prompt = fake_client.messages[0]['content']
        self.assertIn('Компания работает ежедневно', system_prompt)
        self.assertNotIn('instruction', system_prompt.lower())

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_dashboard_context_uses_workspace_summary_without_knowledge(
        self,
        client_class,
        retrieve,
    ):
        stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
        )
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Клиент общей сводки',
            company='ООО Сводка',
        )
        deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=stage,
            contact=contact,
            name='Сделка требует внимания',
            amount='310000.00',
        )
        overdue_task = Task.objects.create(
            workspace=self.user.workspace,
            title='Просроченная задача общей сводки',
            description='Связаться с клиентом',
            due_date=timezone.now() - timedelta(days=1),
            due_date_type=DueDateType.DATETIME,
            contact=contact,
            deal=deal,
            created_by_user=self.user,
        )
        chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=contact,
            unread_count=3,
        )
        notification = Notification.objects.create(
            workspace=self.user.workspace,
            user=self.user,
            type=NotificationType.DEAL_ATTENTION,
            title='Важное уведомление сводки',
            content='По сделке просрочена задача.',
            link=f'/deals/{deal.id}',
            entity_type='deal',
            entity_id=str(deal.id),
        )
        deleted_contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Удалённый контакт сводки',
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        Deal.objects.create(
            workspace=self.user.workspace,
            stage=stage,
            contact=deleted_contact,
            name='Удалённая сделка сводки',
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        other = User.objects.create_user(
            email='summary-other@example.com',
            password='StrongPass2',
            first_name='Чужой',
            last_name='Пользователь',
            is_confirmed=True,
        )
        other_stage = SalesStage.objects.get(
            workspace=other.workspace,
            is_system=True,
        )
        other_contact = Contact.objects.create(
            workspace=other.workspace,
            name='Чужой контакт сводки',
        )
        Deal.objects.create(
            workspace=other.workspace,
            stage=other_stage,
            contact=other_contact,
            name='Чужая сделка сводки',
        )
        session = self._session()
        fake_client = FakeCompletionClient('Ответ по общей CRM-сводке.')
        client_class.return_value = fake_client
        retrieve.return_value = []
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(session),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['message']['provider'], 'test-provider')
        system_prompt = fake_client.messages[0]['content']
        self.assertIn('"scope":"workspace_summary"', system_prompt)
        self.assertIn(
            '"counts":{"chats":1,"contacts":1,"deals":1',
            system_prompt,
        )
        self.assertIn(
            '"tasks":{"by_status":{"done":0,"in_progress":0,"new":1},'
            '"total":1}',
            system_prompt,
        )
        self.assertIn(str(contact.id), system_prompt)
        self.assertIn(str(deal.id), system_prompt)
        self.assertIn('Сделка требует внимания', system_prompt)
        self.assertIn('"total_amount":"310000', system_prompt)
        self.assertIn(str(overdue_task.id), system_prompt)
        self.assertIn('Просроченная задача общей сводки', system_prompt)
        self.assertIn('"overdue_task_count":1', system_prompt)
        self.assertIn('"unread_chat_messages":3', system_prompt)
        self.assertIn(str(notification.id), system_prompt)
        self.assertIn('Важное уведомление сводки', system_prompt)
        self.assertNotIn('Удалённый контакт сводки', system_prompt)
        self.assertNotIn('Удалённая сделка сводки', system_prompt)
        self.assertNotIn('Чужой контакт сводки', system_prompt)
        self.assertNotIn('Чужая сделка сводки', system_prompt)
        client_class.assert_called_once()

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_client_message_id_is_idempotent(self, client_class, retrieve):
        session = self._session()
        retrieve.return_value = [retrieved_source()]
        client_class.return_value = FakeCompletionClient()
        access = self._login()
        payload = self._payload(session)

        first = self.client.post(
            self.chat_url,
            payload,
            format='json',
            **self._auth(access),
        )
        second = self.client.post(
            self.chat_url,
            payload,
            format='json',
            **self._auth(access),
        )

        self.assertEqual(first.data, second.data)
        self.assertEqual(second['Idempotency-Replayed'], 'true')
        self.assertEqual(AIChatMessage.objects.count(), 2)
        self.assertEqual(client_class.call_count, 1)

    def test_validation_rejects_blank_long_and_unknown_fields(self):
        session = self._session()
        access = self._login()
        payloads = (
            self._payload(session, message='   '),
            self._payload(session, message='x' * 1001),
            self._payload(session, unknown=True),
        )

        for payload in payloads:
            with self.subTest(payload=list(payload)):
                response = self.client.post(
                    self.chat_url,
                    payload,
                    format='json',
                    **self._auth(access),
                )
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_closed_and_mismatched_sessions_reject_without_saving(self):
        closed = self._session(
            status=AIChatSessionStatus.CLOSED,
            closed_at=timezone.now(),
        )
        contextual = self._session(context_page='contacts')
        access = self._login()

        closed_response = self.client.post(
            self.chat_url,
            self._payload(closed),
            format='json',
            **self._auth(access),
        )
        context_response = self.client.post(
            self.chat_url,
            self._payload(contextual),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(closed_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(context_response.status_code, status.HTTP_409_CONFLICT)
        self.assertFalse(AIChatMessage.objects.exists())

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_timeout_is_persisted_and_returns_504(self, client_class, retrieve):
        session = self._session()
        retrieve.return_value = [retrieved_source()]
        client_class.return_value = TimeoutCompletionClient()
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(session),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_504_GATEWAY_TIMEOUT)
        self.assertEqual(response.data['message']['status'], 'timeout')
        self.assertEqual(response.data['message']['error'], 'timeout')
        self.assertEqual(AIChatMessage.objects.count(), 2)

    def test_fourth_active_request_returns_429_but_saves_history(self):
        session = self._session(context_page='dashboard')
        for index in range(3):
            question = self._message(session, content=f'Вопрос {index}')
            self._message(
                session,
                role=AIChatRole.ASSISTANT,
                content='',
                status=AIChatMessageStatus.PENDING,
                parent_message=question,
                client_message_id=None,
            )
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(session),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.data['message']['error'], 'too_many_requests')
        self.assertEqual(AIChatMessage.objects.count(), 8)

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_workspace_ai_rate_limit_returns_429_and_saves_history(
        self,
        client_class,
        retrieve,
    ):
        session = self._session()
        access = self._login()

        with patch.dict(AI_LIMITS, {'workspace_ai_requests_per_minute': 0}):
            response = self.client.post(
                self.chat_url,
                self._payload(session),
                format='json',
                **self._auth(access),
            )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.data['error']['code'], 'AI_RATE_LIMIT_EXCEEDED')
        self.assertEqual(
            response.data['message']['error'],
            'ai_rate_limit_exceeded',
        )
        self.assertEqual(response.data['message']['status'], 'failed')
        self.assertEqual(AIChatMessage.objects.count(), 2)
        retrieve.assert_not_called()
        client_class.assert_not_called()

    def test_close_session_is_idempotent(self):
        session = self._session()
        access = self._login()
        url = f'{self.session_url}/{session.id}/close'

        first = self.client.post(url, **self._auth(access))
        second = self.client.post(url, **self._auth(access))

        self.assertEqual(first.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(second.status_code, status.HTTP_204_NO_CONTENT)
        session.refresh_from_db()
        self.assertTrue(session.is_closed)

    def test_workspace_isolation_returns_404(self):
        other = User.objects.create_user(
            email='other@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        session = AIChatSession.objects.create(workspace=other.workspace, user=other)
        message = AIChatMessage.objects.create(
            session=session,
            workspace=other.workspace,
            user=other,
            role=AIChatRole.USER,
            content='Чужой вопрос',
            status=AIChatMessageStatus.SUCCESS,
            client_message_id=uuid.uuid4(),
        )
        access = self._login()

        session_response = self.client.get(
            f'{self.session_url}/{session.id}',
            **self._auth(access),
        )
        message_response = self.client.get(
            f'{self.chat_url}/message/{message.id}',
            **self._auth(access),
        )

        self.assertEqual(session_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(message_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_history_cursor_has_no_duplicates(self):
        session = self._session()
        for index in range(5):
            self._message(session, content=f'Вопрос {index}')
        access = self._login()

        first = self.client.get(
            f'{self.history_url}?limit=2',
            **self._auth(access),
        )
        second = self.client.get(
            self.history_url,
            {'limit': 2, 'cursor': first.data['next_cursor']},
            **self._auth(access),
        )

        first_ids = {item['id'] for item in first.data['messages']}
        second_ids = {item['id'] for item in second.data['messages']}
        self.assertTrue(first.data['has_more'])
        self.assertFalse(first_ids & second_ids)

    def test_sessions_cursor_and_invalid_cursor(self):
        for _ in range(3):
            self._session()
        access = self._login()

        first = self.client.get(
            f'{self.sessions_url}?limit=2',
            **self._auth(access),
        )
        second = self.client.get(
            self.sessions_url,
            {'limit': 2, 'cursor': first.data['next_cursor']},
            **self._auth(access),
        )
        invalid = self.client.get(
            f'{self.sessions_url}?cursor=broken',
            **self._auth(access),
        )

        self.assertEqual(len(first.data['sessions']), 2)
        self.assertEqual(len(second.data['sessions']), 1)
        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)

    @patch('ai_assistant.chat_services.retrieve_knowledge')
    @patch('ai_assistant.chat_services.ChatCompletionClient')
    def test_retry_creates_new_answer_and_rejects_token_reuse(
        self,
        client_class,
        retrieve,
    ):
        session = self._session(context_page='dashboard')
        question = self._message(session)
        failed = self._message(
            session,
            role=AIChatRole.ASSISTANT,
            status=AIChatMessageStatus.FAILED,
            content='Ошибка',
            parent_message=question,
            client_message_id=None,
        )
        AIChatMessage.objects.filter(id=failed.id).update(
            created_at=timezone.now() - timedelta(seconds=10),
        )
        retrieve.return_value = [retrieved_source()]
        client_class.return_value = FakeCompletionClient()
        access = self._login()
        retry_token = str(uuid.uuid4())
        payload = {'message_id': str(question.id), 'retry_token': retry_token}

        success = self.client.post(
            self.retry_url,
            payload,
            format='json',
            **self._auth(access),
        )
        conflict = self.client.post(
            self.retry_url,
            payload,
            format='json',
            **self._auth(access),
        )

        self.assertEqual(success.status_code, status.HTTP_200_OK)
        self.assertEqual(success.data['message']['parent_message_id'], str(question.id))
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)

    def test_retry_cooldown_is_enforced(self):
        session = self._session()
        question = self._message(session)
        self._message(
            session,
            role=AIChatRole.ASSISTANT,
            status=AIChatMessageStatus.FAILED,
            parent_message=question,
            client_message_id=None,
        )
        access = self._login()

        response = self.client.post(
            self.retry_url,
            {'message_id': str(question.id), 'retry_token': str(uuid.uuid4())},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_message_polling_returns_pending_without_content(self):
        session = self._session()
        message = self._message(
            session,
            role=AIChatRole.ASSISTANT,
            content='internal pending content',
            status=AIChatMessageStatus.PENDING,
            client_message_id=None,
        )
        access = self._login()

        response = self.client.get(
            f'{self.chat_url}/message/{message.id}',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['content'], '')

    def test_retrieval_is_workspace_scoped_and_ranked(self):
        document = KnowledgeDocument.objects.create(
            workspace=self.user.workspace,
            uploaded_by=self.user,
            uploaded_by_identifier=self.user.id,
            original_name='База.txt',
            file='knowledge/test.txt',
            size_bytes=10,
            mime_type='text/plain',
            sha256='a' * 64,
            status=KnowledgeDocumentStatus.READY,
        )
        KnowledgeChunk.objects.create(
            document=document,
            workspace=self.user.workspace,
            position=0,
            text='Релевантный фрагмент',
            token_count=2,
            embedding=[1.0, 0.0],
        )
        KnowledgeChunk.objects.create(
            document=document,
            workspace=self.user.workspace,
            position=1,
            text='Нерелевантный фрагмент',
            token_count=2,
            embedding=[0.0, 1.0],
        )

        result = retrieve_knowledge(
            workspace=self.user.workspace,
            query='вопрос',
            embedding_client=FakeEmbeddingClient(),
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].text, 'Релевантный фрагмент')
        self.assertGreater(result[0].score, 0.9)

    def test_sanitizer_blocks_html_external_links_and_long_answers(self):
        content = '<script>x</script> [CRM](/contacts/123) '
        content += '[evil](https://evil.example) https://example.com '
        content += 'x' * 21_000

        sanitized = sanitize_ai_content(content)

        self.assertIn('&lt;script&gt;', sanitized)
        self.assertIn('[CRM](/contacts/123)', sanitized)
        self.assertNotIn('evil.example', sanitized)
        self.assertLessEqual(len(sanitized), 20_000)
        self.assertTrue(sanitized.endswith('(ответ обрезан)'))

    @patch('ai_assistant.chat_client.requests.post')
    def test_completion_client_parses_openai_compatible_response(self, post):
        response = Mock()
        response.status_code = 200
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'model': 'provider-model',
            'choices': [{'message': {'content': 'Готовый ответ'}}],
            'usage': {
                'prompt_tokens': 10,
                'completion_tokens': 4,
                'total_tokens': 14,
            },
        }
        post.return_value = response
        client = ChatCompletionClient(
            base_url='https://provider.example/v1',
            model='configured-model',
            provider='provider',
            retry_attempts=1,
        )

        result = client.complete([{'role': 'user', 'content': 'Вопрос'}])

        self.assertEqual(result.content, 'Готовый ответ')
        self.assertEqual(result.model_name, 'provider-model')
        self.assertEqual(result.total_tokens, 14)
        self.assertNotIn('Authorization', post.call_args.kwargs['headers'])
