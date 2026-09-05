from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from users.models import User
from workspaces.crypto import encrypt_integration_secret
from workspaces.models import (
    IntegrationStatus,
    IntegrationType,
    TelegramWebhookLog,
    WorkspaceIntegration,
)

from .models import Chat
from .telegram import process_telegram_webhook_log


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class ChatContractTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='chat-contract@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _connect_telegram(self):
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

    def _chat(self, suffix):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name=f'Клиент {suffix}',
            telegram_user_id=1000 + suffix,
            telegram_chat_id=1000 + suffix,
        )
        return Chat.objects.create(
            workspace=self.user.workspace,
            contact=contact,
        )

    def test_chat_detail_returns_only_own_active_chat(self):
        own_chat = self._chat(11)
        other_user = User.objects.create_user(
            email='chat-contract-other@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        other_contact = Contact.objects.create(
            workspace=other_user.workspace,
            name='Чужой клиент',
        )
        other_chat = Chat.objects.create(
            workspace=other_user.workspace,
            contact=other_contact,
        )
        deleted_chat = self._chat(12)
        deleted_chat.is_deleted = True
        deleted_chat.save(update_fields=('is_deleted', 'updated_at'))

        own_response = self.client.get(f'/api/chats/{own_chat.id}')
        foreign_response = self.client.get(f'/api/chats/{other_chat.id}')
        deleted_response = self.client.get(f'/api/chats/{deleted_chat.id}')

        self.assertEqual(own_response.status_code, status.HTTP_200_OK)
        self.assertEqual(own_response.data['id'], str(own_chat.id))
        self.assertEqual(foreign_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(deleted_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_message_rate_limit_applies_per_chat_and_workspace(self):
        self._connect_telegram()
        first_chat = self._chat(1)
        second_chat = self._chat(2)

        for index in range(20):
            response = self.client.post(
                f'/api/chats/{first_chat.id}/messages',
                {'text': f'Сообщение {index}'},
                format='json',
                HTTP_IDEMPOTENCY_KEY=f'first-chat-{index}',
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        blocked = self.client.post(
            f'/api/chats/{first_chat.id}/messages',
            {'text': 'Лишнее сообщение'},
            format='json',
            HTTP_IDEMPOTENCY_KEY='first-chat-over-limit',
        )
        self.assertEqual(blocked.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(blocked.data['error'], 'rate_limit_exceeded')

        other_chat = self.client.post(
            f'/api/chats/{second_chat.id}/messages',
            {'text': 'Глобальный лимит должен блокировать и другой чат'},
            format='json',
            HTTP_IDEMPOTENCY_KEY='second-chat-over-workspace-limit',
        )
        self.assertEqual(other_chat.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(other_chat.data['error'], 'rate_limit_exceeded')

    @patch('messaging.telegram.broadcast_workspace_event')
    def test_new_chat_event_precedes_message_with_zero_unread(self, broadcast):
        webhook_log = TelegramWebhookLog.objects.create(
            workspace=self.user.workspace,
            update_id=501,
            payload={
                'update_id': 501,
                'message': {
                    'message_id': 501,
                    'from': {
                        'id': 777501,
                        'is_bot': False,
                        'first_name': 'Пётр',
                        'last_name': 'Петров',
                        'username': 'petr_contract',
                    },
                    'chat': {'id': 777501, 'type': 'private'},
                    'text': 'Здравствуйте',
                },
            },
        )

        with self.captureOnCommitCallbacks(execute=True):
            processed = process_telegram_webhook_log(webhook_log.id)

        self.assertTrue(processed)
        self.assertEqual(broadcast.call_count, 2)
        created_payload = broadcast.call_args_list[0].args[1]
        message_payload = broadcast.call_args_list[1].args[1]

        self.assertEqual(created_payload['event'], 'chat_created')
        self.assertIsNone(created_payload['chat']['last_message'])
        self.assertIsNone(created_payload['chat']['last_message_at'])
        self.assertEqual(created_payload['chat']['unread_count'], 0)
        self.assertEqual(message_payload['event'], 'message_new')
        self.assertEqual(
            message_payload['chat_id'],
            created_payload['chat']['id'],
        )
