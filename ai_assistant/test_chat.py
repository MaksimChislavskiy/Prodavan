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

    def test_no_relevant_knowledge_returns_safe_internal_answer(self):
        session = self._session()
        access = self._login()

        response = self.client.post(
            self.chat_url,
            self._payload(session),
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['message']['provider'], 'internal')
        self.assertTrue(
            response.data['message']['metadata']['no_relevant_knowledge'],
        )

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
