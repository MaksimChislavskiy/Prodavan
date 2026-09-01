from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import AIAuditAction, AIAuditLog, AISettings


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class NewTzAISettingsAuditTests(TestCase):
    settings_url = '/api/ai/settings'
    login_url = '/api/auth/login'

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='ai-audit@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        login_response = self.client.post(
            self.login_url,
            {'email': self.user.email, 'password': 'StrongPass1'},
            format='json',
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        self.auth = {
            'HTTP_AUTHORIZATION': f"Bearer {login_response.data['access_token']}",
        }

    def test_enabling_autopilot_writes_required_audit_action(self):
        response = self.client.patch(
            self.settings_url,
            {'version': 0, 'autopilot_enabled': True},
            format='json',
            **self.auth,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        audit = AIAuditLog.objects.get()
        self.assertEqual(audit.action, AIAuditAction.AUTOPILOT_ENABLED)
        self.assertEqual(
            audit.changes,
            {'autopilot_enabled': {'old': False, 'new': True}},
        )

    def test_disabling_autopilot_writes_required_audit_action(self):
        AISettings.objects.create(
            workspace=self.user.workspace,
            autopilot_enabled=True,
        )

        response = self.client.patch(
            self.settings_url,
            {'version': 0, 'autopilot_enabled': False},
            format='json',
            **self.auth,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        audit = AIAuditLog.objects.get()
        self.assertEqual(audit.action, AIAuditAction.AUTOPILOT_DISABLED)
        self.assertEqual(
            audit.changes,
            {'autopilot_enabled': {'old': True, 'new': False}},
        )

    def test_version_conflict_message_matches_new_tz(self):
        AISettings.objects.create(
            workspace=self.user.workspace,
            version=2,
            instruction='Актуальная инструкция',
        )

        response = self.client.patch(
            self.settings_url,
            {'version': 1, 'instruction': 'Устаревшее изменение'},
            format='json',
            **self.auth,
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(
            response.data['error']['message'],
            'Настройки были изменены другим пользователем или в другой вкладке. '
            'Обновите страницу и повторите попытку.',
        )
