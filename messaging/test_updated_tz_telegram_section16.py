from django.core.cache import cache
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from users.models import User
from workspaces.crypto import encrypt_integration_secret
from workspaces.models import IntegrationStatus, IntegrationType, WorkspaceIntegration

from .models import Chat


class TelegramWorkspaceRateLimitContractTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='telegram-limit@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        token = '123456789:AAExample_bot_token-with-safe_chars'
        WorkspaceIntegration.objects.create(
            workspace=self.user.workspace,
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
            config=encrypt_integration_secret(
                secret=token,
                workspace_id=self.user.workspace_id,
                integration_type=IntegrationType.TELEGRAM,
            ),
        )
        first_contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Первый клиент',
            telegram_chat_id=10001,
        )
        second_contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Второй клиент',
            telegram_chat_id=10002,
        )
        self.first_chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=first_contact,
        )
        self.second_chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=second_contact,
        )

    def _send(self, chat, index):
        return self.client.post(
            f'/api/chats/{chat.id}/messages',
            {'text': f'Сообщение {index}'},
            format='json',
            HTTP_IDEMPOTENCY_KEY=f'section16-{index}',
        )

    def test_workspace_limit_applies_across_different_chats(self):
        for index in range(10):
            first = self._send(self.first_chat, index)
            second = self._send(self.second_chat, index + 10)
            self.assertEqual(first.status_code, status.HTTP_201_CREATED)
            self.assertEqual(second.status_code, status.HTTP_201_CREATED)

        response = self._send(self.first_chat, 20)

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.data['error'], 'rate_limit_exceeded')
