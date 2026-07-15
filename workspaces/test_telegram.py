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
    TelegramWebhookLog,
)
from .telegram import TelegramApiUnavailable, TelegramInvalidToken
from .telegram_services import check_telegram_integration


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    TELEGRAM_WEBHOOK_BASE_URL='https://crm.example.com',
)
class TelegramIntegrationTests(TestCase):
    connect_url = '/api/settings/integrations/telegram/connect'
    disconnect_url = '/api/settings/integrations/telegram/disconnect'
    settings_url = '/api/settings/integrations/telegram'
    webhook_logs_url = '/api/settings/integrations/telegram/webhook-logs'
    login_url = '/api/auth/login'
    token = '123456789:AAExample_bot_token-with-safe_chars'

    def setUp(self):
        cache.clear()
        self.set_webhook_patcher = patch(
            'workspaces.telegram.TelegramBotApiClient.set_webhook',
        )
        self.delete_webhook_patcher = patch(
            'workspaces.telegram.TelegramBotApiClient.delete_webhook',
        )
        self.set_webhook = self.set_webhook_patcher.start()
        self.delete_webhook = self.delete_webhook_patcher.start()
        self.addCleanup(self.set_webhook_patcher.stop)
        self.addCleanup(self.delete_webhook_patcher.stop)
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
        self.assertTrue(integration.credential_fingerprint)
        self.assertTrue(integration.webhook_secret_hash)
        webhook_secret = decrypt_integration_secret(
            envelope=integration.webhook_secret_config,
            workspace_id=self.user.workspace_id,
            integration_type=IntegrationType.TELEGRAM,
        )
        self.set_webhook.assert_called_once_with(
            self.token,
            url=(
                'https://crm.example.com/api/integrations/telegram/'
                f'webhook/{webhook_secret}'
            ),
            secret_token=webhook_secret,
        )
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
        connected_audit = WorkspaceAuditLog.objects.get(
            workspace=self.user.workspace,
            field='telegram_bot_connected',
        )
        self.assertEqual(connected_audit.user, self.user)
        self.assertEqual(
            json.loads(connected_audit.new_value),
            {
                'bot_username': '@sales_bot',
                'health_status': IntegrationHealth.HEALTHY,
                'reconnected': False,
            },
        )

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
        connected_audits = WorkspaceAuditLog.objects.filter(
            workspace=self.user.workspace,
            field='telegram_bot_connected',
        )
        self.assertEqual(connected_audits.count(), 2)
        self.assertTrue(
            json.loads(connected_audits.first().new_value)['reconnected'],
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
        self.assertEqual(integration.credential_fingerprint, '')
        self.assertEqual(integration.webhook_secret_config, {})
        self.assertEqual(integration.webhook_secret_hash, '')
        self.delete_webhook.assert_called_once_with(self.token)
        disconnected_audit = WorkspaceAuditLog.objects.get(
            workspace=self.user.workspace,
            field='telegram_bot_disconnected',
        )
        self.assertEqual(disconnected_audit.user, self.user)
        self.assertEqual(
            json.loads(disconnected_audit.new_value),
            {
                'bot_username': '@sales_bot',
                'webhook_cleanup_confirmed': True,
            },
        )

    @patch('workspaces.telegram.TelegramBotApiClient.get_webhook_info')
    @patch('workspaces.telegram.TelegramBotApiClient.get_me')
    def test_disconnect_audit_marks_unconfirmed_webhook_cleanup(
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
        self.delete_webhook.side_effect = TelegramApiUnavailable('offline')

        response = self.client.post(
            self.disconnect_url,
            {},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        integration = WorkspaceIntegration.objects.get(
            workspace=self.user.workspace,
        )
        self.assertEqual(integration.status, IntegrationStatus.DISCONNECTED)
        disconnected_audit = WorkspaceAuditLog.objects.get(
            workspace=self.user.workspace,
            field='telegram_bot_disconnected',
        )
        self.assertFalse(
            json.loads(disconnected_audit.new_value)[
                'webhook_cleanup_confirmed'
            ],
        )

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

    @override_settings(TELEGRAM_WEBHOOK_BASE_URL='')
    def test_connect_requires_public_https_webhook_url(self):
        access = self._login()

        response = self.client.post(
            self.connect_url,
            {'bot_token': self.token},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(
            response.data['error']['code'],
            'TELEGRAM_WEBHOOK_URL_NOT_CONFIGURED',
        )

    @patch('workspaces.telegram.TelegramBotApiClient.get_webhook_info')
    @patch('workspaces.telegram.TelegramBotApiClient.get_me')
    def test_same_bot_cannot_be_connected_to_two_workspaces(
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
        second_user = User.objects.create_user(
            email='second@example.com',
            password='StrongPass1',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        response = self.client.post(
            self.login_url,
            {'email': second_user.email, 'password': 'StrongPass1'},
            format='json',
        )
        second_access = response.data['access_token']

        response = self.client.post(
            self.connect_url,
            {'bot_token': self.token},
            format='json',
            **self._auth(second_access),
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(
            response.data['error']['code'],
            'TELEGRAM_TOKEN_ALREADY_IN_USE',
        )

    def test_get_settings_returns_disconnected_state_before_connect(self):
        access = self._login()

        response = self.client.get(
            self.settings_url,
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data['integration']['status'],
            IntegrationStatus.DISCONNECTED,
        )
        self.assertFalse(
            response.data['integration']['webhook_configured'],
        )

    @patch('workspaces.telegram.TelegramBotApiClient.get_webhook_info')
    @patch('workspaces.telegram.TelegramBotApiClient.get_me')
    def test_webhook_is_authenticated_logged_and_deduplicated(
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
        integration = WorkspaceIntegration.objects.get(
            workspace=self.user.workspace,
        )
        webhook_secret = decrypt_integration_secret(
            envelope=integration.webhook_secret_config,
            workspace_id=self.user.workspace_id,
            integration_type=IntegrationType.TELEGRAM,
        )
        webhook_url = (
            f'/api/integrations/telegram/webhook/{webhook_secret}'
        )
        payload = {
            'update_id': 123,
            'message': {'text': 'Здравствуйте'},
        }

        first = self.client.post(
            webhook_url,
            payload,
            format='json',
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=webhook_secret,
        )
        second = self.client.post(
            webhook_url,
            payload,
            format='json',
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=webhook_secret,
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(
            TelegramWebhookLog.objects.filter(
                workspace=self.user.workspace,
                update_id=123,
            ).count(),
            1,
        )
        logs = self.client.get(
            self.webhook_logs_url,
            **self._auth(access),
        )
        self.assertEqual(logs.status_code, status.HTTP_200_OK)
        self.assertEqual(logs.data['results'][0]['update_id'], 123)

    @patch('workspaces.telegram.TelegramBotApiClient.get_webhook_info')
    @patch('workspaces.telegram.TelegramBotApiClient.get_me')
    def test_webhook_rejects_wrong_header(self, get_me, get_webhook_info):
        get_me.return_value = self._bot()
        get_webhook_info.return_value = self._webhook()
        access = self._login()
        self.client.post(
            self.connect_url,
            {'bot_token': self.token},
            format='json',
            **self._auth(access),
        )
        integration = WorkspaceIntegration.objects.get(
            workspace=self.user.workspace,
        )
        webhook_secret = decrypt_integration_secret(
            envelope=integration.webhook_secret_config,
            workspace_id=self.user.workspace_id,
            integration_type=IntegrationType.TELEGRAM,
        )

        response = self.client.post(
            f'/api/integrations/telegram/webhook/{webhook_secret}',
            {'update_id': 456},
            format='json',
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN='wrong',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(TelegramWebhookLog.objects.exists())

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
