from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from messaging.models import Chat, Message, MessageSenderType, MessageStatus
from users.models import User
from workspaces.models import IntegrationStatus, IntegrationType, WorkspaceIntegration

from .autopilot import process_autopilot_job
from .automation import process_automation_event
from .chat_client import ChatCompletionResult
from .models import (
    AIAutomationAuditAction,
    AIAutomationAuditLog,
    AISettings,
    AutopilotMode,
)
from .retrieval import RetrievedChunk


class DummyAnalyzer:
    def __init__(self, payload):
        self.payload = payload

    def analyze(self, *, event, context_messages):
        return self.payload


class FakeCompletionClient:
    def complete(self, messages):
        return ChatCompletionResult(
            content='Ответ из базы знаний.',
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


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    AI_AUTOMATION_CONFIDENCE_THRESHOLD=0.7,
)
class AIAuditApiTests(TestCase):
    audit_url = '/api/ai/audit'
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

    def _login(self):
        response = self.client.post(
            self.login_url,
            {'email': 'owner@example.com', 'password': 'StrongPass1'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data['access_token']

    @staticmethod
    def _auth(access):
        return {'HTTP_AUTHORIZATION': f'Bearer {access}'}

    def incoming(self, text):
        return Message.objects.create(
            chat=self.chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=self.contact.id,
            text=text,
        )

    def test_endpoint_requires_authentication(self):
        response = self.client.get(self.audit_url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_automation_processing_writes_audit_logs_and_endpoint_returns_them(self):
        message = self.incoming('Хочу купить внедрение, перезвоните.')
        analyzer = DummyAnalyzer({
            'contact': {
                'confidence': 0.9,
                'fields': {'company': 'ООО Ромашка'},
            },
            'deal': {
                'interest_confidence': 0.9,
                'create': True,
                'name': 'Внедрение CRM',
            },
            'task': {
                'confidence': 0.9,
                'create': True,
                'title': 'Перезвонить клиенту',
            },
        })

        process_automation_event(message.ai_automation_event.id, analyzer=analyzer)

        actions = set(
            AIAutomationAuditLog.objects.values_list('action', flat=True),
        )
        self.assertIn(AIAutomationAuditAction.AI_CONTACT_UPDATED, actions)
        self.assertIn(AIAutomationAuditAction.AI_DEAL_CREATED, actions)
        self.assertIn(AIAutomationAuditAction.AI_TASK_CREATED, actions)
        access = self._login()
        response = self.client.get(self.audit_url, **self._auth(access))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data['logs']), 3)
        first = response.data['logs'][0]
        self.assertIn('raw_message', first)
        self.assertIn('ai_response', first)
        self.assertIn('details', first)

    def test_autopilot_filter_returns_only_autopilot_logs(self):
        AISettings.objects.create(
            workspace=self.workspace,
            autopilot_enabled=True,
            autopilot_mode=AutopilotMode.ALWAYS,
        )
        WorkspaceIntegration.objects.create(
            workspace=self.workspace,
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
            config={'encrypted': 'token'},
        )
        message = self.incoming('Когда вы работаете?')
        job = message.ai_autopilot_job
        now = timezone.now() + timedelta(seconds=11)
        job.available_at = now
        job.save(update_fields=('available_at', 'updated_at'))

        process_autopilot_job(
            job.id,
            retrieval_func=lambda **kwargs: [fake_source()],
            completion_client=FakeCompletionClient(),
            now=now,
        )

        access = self._login()
        response = self.client.get(
            self.audit_url,
            {'type': 'autopilot'},
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['logs']), 1)
        self.assertEqual(
            response.data['logs'][0]['action'],
            AIAutomationAuditAction.AI_AUTOPILOT_SENT,
        )
        self.assertEqual(
            response.data['logs'][0]['action_type'],
            'autopilot_reply',
        )

    def test_cursor_pagination_and_validation(self):
        logs = []
        for index in range(3):
            logs.append(
                AIAutomationAuditLog.objects.create(
                    workspace=self.workspace,
                    user=self.user,
                    action=AIAutomationAuditAction.AI_DECISION_SKIPPED,
                    action_type=f'test_{index}',
                    trigger='test',
                    correlation_id=self.user.id,
                    chat=self.chat,
                    details={'index': index},
                ),
            )
        base = timezone.now() - timedelta(minutes=5)
        for index, log in enumerate(logs):
            AIAutomationAuditLog.objects.filter(id=log.id).update(
                created_at=base + timedelta(seconds=index),
            )
        access = self._login()

        first = self.client.get(
            self.audit_url,
            {'limit': 2},
            **self._auth(access),
        )
        second = self.client.get(
            self.audit_url,
            {'limit': 2, 'cursor': first.data['next_cursor']},
            **self._auth(access),
        )
        invalid = self.client.get(
            self.audit_url,
            {'cursor': 'broken'},
            **self._auth(access),
        )
        invalid_type = self.client.get(
            self.audit_url,
            {'type': 'unknown'},
            **self._auth(access),
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertTrue(first.data['has_more'])
        self.assertEqual(len(second.data['logs']), 1)
        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(invalid_type.status_code, status.HTTP_400_BAD_REQUEST)
