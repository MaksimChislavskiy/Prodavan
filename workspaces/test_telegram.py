import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User, UserRole

from .crypto import (
    IntegrationSecretError,
    decrypt_integration_secret,
    encrypt_integration_secret,
)
from .models import (
    IntegrationHealth,
    IntegrationStatus,
    IntegrationType,
    WorkspaceAuditLog,
    WorkspaceIntegration,
)
from .telegram import TelegramApiUnavailable, TelegramInvalidToken
from .telegram_services import check_telegram_integration


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class TelegramIntegrationTests(TestCase):
    connect_url = '/api/settings/integrations/telegram/connect'
    disconnect_url = '/api/settings/integrations/telegram/disconnect'
    login_url = '/api/auth/login'
    token = '123456789:AAExample_bot_token-with-safe_chars'

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

    @staticmethod
    def _bot():
        return {'id': 123456789, 'is_bot': True, 'username': 'sales_bot'}

    @staticmethod
    def _webhook():
        return {
            'url': 'https://example.com/webhooks/telegram',
            'pending_update_count': 0,
        }

    def test_aes_gcm_roundtrip_never_stores_plaintext(self):
        envelope = encrypt_integration_secret(
            secret=self.token,
            workspace_id=self.user.workspace_id,
            integration_type=IntegrationType.TELEGRAM,
        )

        self.assertNotIn(self.token, json.dumps(envelope))
        self.assertEqual(envelope['algorithm'], 'AES-256-GCM')
        self.assertEqual(
            decrypt_integration_secret(
                envelope=envelope,
                workspace_id=self.user.workspace_id,
                integration_type=IntegrationType.TELEGRAM,
            ),
            self.token,
        )

    def test_aes_gcm_detects_ciphertext_tampering(self):
        envelope = encrypt_integration_secret(
            secret=self.token,
            workspace_id=self.user.workspace_id,
            integration_type=IntegrationType.TELEGRAM,
        )
        envelope['ciphertext'] = envelope['ciphertext'][:-2] + 'AA'

        with self.assertRaises(IntegrationSecretError):
            decrypt_integration_secret(
                envelope=envelope,
                workspace_id=self.user.workspace_id,
                integration_type=IntegrationType.TELEGRAM,
            )

    @patch('workspaces.telegram.TelegramBotApiClient.get_webhook_info')
    @patch('workspaces.telegram.TelegramBotApiClient.get_me')
    def test_connect_encrypts_token_and_returns_only_metadata(
        self,
        get_me,
        get_webhook_info,
    ):
        get_me.return_value = self._bot()
        get_webhook_info.return_value = self._webhook()
        access = self._login()

        response = self.client.post(
            self.connect_url,
            {'bot_token': self.token},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        integration = WorkspaceIntegration.objects.get(
            workspace=self.user.workspace,
            type=IntegrationType.TELEGRAM,
        )
        self.assertEqual(integration.status, IntegrationStatus.CONNECTED)
        self.assertEqual(integration.health_status, IntegrationHealth.HEALTHY)
        self.assertEqual(integration.bot_username, '@sales_bot')
        self.assertNotIn(self.token, json.dumps(integration.config))
        self.assertNotIn('config', response.data['integration'])
        audit_text = json.dumps(
            list(
                WorkspaceAuditLog.objects.values_list(
                    'old_value',
                    'new_value',
                ),
            ),
        )
        self.assertNotIn(self.token, audit_text)

    @patch('workspaces.telegram.TelegramBotApiClient.get_webhook_info')
    @patch('workspaces.telegram.TelegramBotApiClient.get_me')
    def test_reconnect_preserves_connected_at(self, get_me, get_webhook_info):
        get_me.return_value = self._bot()
        get_webhook_info.return_value = self._webhook()
        access = self._login()
        self.client.post(
            self.connect_url,
            {'bot_token': self.token},
            format='json',
            **self._auth(access),
        )
        integration = WorkspaceIntegration.objects.get(workspace=self.user.workspace)
        connected_at = integration.connected_at

        response = self.client.post(
            self.connect_url,
            {'bot_token': '987654321:AAAnother-safe-bot-token'},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        integration.refresh_from_db()
        self.assertEqual(integration.connected_at, connected_at)
        self.assertTrue(
            WorkspaceAuditLog.objects.filter(
                field='integration.telegram.reconnected',
            ).exists(),
        )

    @patch('workspaces.telegram.TelegramBotApiClient.get_webhook_info')
    @patch('workspaces.telegram.TelegramBotApiClient.get_me')
    def test_disconnect_clears_encrypted_token(self, get_me, get_webhook_info):
        get_me.return_value = self._bot()
        get_webhook_info.return_value = self._webhook()
        access = self._login()
        self.client.post(
            self.connect_url,
            {'bot_token': self.token},
            format='json',
            **self._auth(access),
        )

        response = self.client.post(
            self.disconnect_url,
            {},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        integration = WorkspaceIntegration.objects.get(workspace=self.user.workspace)
        self.assertEqual(integration.status, IntegrationStatus.DISCONNECTED)
        self.assertIsNone(integration.health_status)
        self.assertEqual(integration.config, {})

    @patch('workspaces.telegram.TelegramBotApiClient.get_me')
    def test_connect_rejects_invalid_token(self, get_me):
        get_me.side_effect = TelegramInvalidToken('invalid')
        access = self._login()

        response = self.client.post(
            self.connect_url,
            {'bot_token': self.token},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['error']['code'],
            'INVALID_TELEGRAM_TOKEN',
        )

    @patch('workspaces.telegram.TelegramBotApiClient.get_webhook_info')
    @patch('workspaces.telegram.TelegramBotApiClient.get_me')
    def test_connect_is_limited_to_ten_requests_per_minute(
        self,
        get_me,
        get_webhook_info,
    ):
        get_me.return_value = self._bot()
        get_webhook_info.return_value = self._webhook()
        access = self._login()

        for _ in range(10):
            response = self.client.post(
                self.connect_url,
                {'bot_token': self.token},
                format='json',
                **self._auth(access),
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
        response = self.client.post(
            self.connect_url,
            {'bot_token': self.token},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_non_admin_cannot_connect(self):
        self.user.role = UserRole.USER
        self.user.save(update_fields=('role', 'updated_at'))
        access = self._login()

        response = self.client.post(
            self.connect_url,
            {'bot_token': self.token},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @patch('workspaces.telegram.TelegramBotApiClient.get_webhook_info')
    @patch('workspaces.telegram.TelegramBotApiClient.get_me')
    def test_health_check_switches_to_error_after_three_failures(
        self,
        get_me,
        get_webhook_info,
    ):
        get_me.return_value = self._bot()
        get_webhook_info.return_value = self._webhook()
        access = self._login()
        self.client.post(
            self.connect_url,
            {'bot_token': self.token},
            format='json',
            **self._auth(access),
        )
        integration = WorkspaceIntegration.objects.get(workspace=self.user.workspace)
        get_me.side_effect = TelegramApiUnavailable('offline')

        for _ in range(3):
            check_telegram_integration(integration.id)

        integration.refresh_from_db()
        self.assertEqual(integration.consecutive_failures, 3)
        self.assertEqual(integration.health_status, IntegrationHealth.ERROR)
