import json
from datetime import timedelta
from unittest.mock import Mock, patch

from django.test import TestCase, override_settings
from django.utils import timezone

from users.models import User

from .models import (
    IntegrationHealth,
    IntegrationStatus,
    IntegrationType,
    Workspace,
    WorkspaceAuditLog,
    WorkspaceIntegration,
)
from .telegram_services import (
    check_all_telegram_integrations,
    connect_telegram,
)


class TelegramHealthScheduleContractTests(TestCase):
    def _integration(self, *, name, health, checked_ago, connected=True):
        workspace = Workspace.objects.create(name=name)
        last_check_at = (
            None if checked_ago is None else timezone.now() - checked_ago
        )
        return WorkspaceIntegration.objects.create(
            workspace=workspace,
            type=IntegrationType.TELEGRAM,
            status=(
                IntegrationStatus.CONNECTED
                if connected
                else IntegrationStatus.DISCONNECTED
            ),
            health_status=health,
            last_check_at=last_check_at,
        )

    @patch('workspaces.telegram_services.check_telegram_integration')
    def test_health_checks_use_30_minutes_for_healthy_and_5_for_problem_states(
        self,
        check_integration,
    ):
        check_integration.return_value = True
        healthy_not_due = self._integration(
            name='healthy-not-due',
            health=IntegrationHealth.HEALTHY,
            checked_ago=timedelta(minutes=29),
        )
        healthy_due = self._integration(
            name='healthy-due',
            health=IntegrationHealth.HEALTHY,
            checked_ago=timedelta(minutes=31),
        )
        degraded_not_due = self._integration(
            name='degraded-not-due',
            health=IntegrationHealth.DEGRADED,
            checked_ago=timedelta(minutes=4),
        )
        degraded_due = self._integration(
            name='degraded-due',
            health=IntegrationHealth.DEGRADED,
            checked_ago=timedelta(minutes=6),
        )
        error_due = self._integration(
            name='error-due',
            health=IntegrationHealth.ERROR,
            checked_ago=timedelta(minutes=6),
        )
        never_checked = self._integration(
            name='never-checked',
            health=None,
            checked_ago=None,
        )
        disconnected = self._integration(
            name='disconnected',
            health=IntegrationHealth.ERROR,
            checked_ago=timedelta(hours=1),
            connected=False,
        )

        checked = check_all_telegram_integrations()

        called_ids = {call.args[0] for call in check_integration.call_args_list}
        self.assertEqual(checked, 4)
        self.assertEqual(
            called_ids,
            {
                healthy_due.id,
                degraded_due.id,
                error_due.id,
                never_checked.id,
            },
        )
        self.assertNotIn(healthy_not_due.id, called_ids)
        self.assertNotIn(degraded_not_due.id, called_ids)
        self.assertNotIn(disconnected.id, called_ids)


@override_settings(TELEGRAM_WEBHOOK_BASE_URL='https://crm.example.com')
class TelegramReconnectAuditContractTests(TestCase):
    token = '123456789:AAExample_bot_token-with-safe_chars'
    replacement_token = '987654321:AAAnother-safe-bot-token'

    def setUp(self):
        self.user = User.objects.create_user(
            email='owner-contract@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.client = Mock()
        self.client.get_me.return_value = {
            'id': 123456789,
            'is_bot': True,
            'username': 'sales_bot',
        }
        self.client.get_webhook_info.return_value = {
            'url': 'https://crm.example.com/webhook',
            'pending_update_count': 0,
        }

    def test_reconnect_writes_exact_audit_event_without_plaintext_token(self):
        connect_telegram(
            workspace=self.user.workspace,
            user=self.user,
            bot_token=self.token,
            client=self.client,
        )
        WorkspaceAuditLog.objects.all().delete()

        connect_telegram(
            workspace=self.user.workspace,
            user=self.user,
            bot_token=self.replacement_token,
            client=self.client,
        )

        audit = WorkspaceAuditLog.objects.get(
            workspace=self.user.workspace,
            field='integration.telegram.reconnected',
        )
        payload = json.loads(audit.new_value)
        self.assertTrue(payload['reconnected'])
        self.assertEqual(payload['bot_username'], '@sales_bot')
        serialized = f'{audit.old_value or ""}{audit.new_value or ""}'
        self.assertNotIn(self.token, serialized)
        self.assertNotIn(self.replacement_token, serialized)
