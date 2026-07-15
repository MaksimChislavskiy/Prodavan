from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User, UserRole

from .models import AIAuditAction, AIAuditLog, AISettings, AIUsageDaily


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class AISettingsApiTests(TestCase):
    url = '/api/ai/settings'
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

    def test_settings_require_authentication(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_non_admin_cannot_read_or_update_settings(self):
        self.user.role = UserRole.USER
        self.user.save(update_fields=('role', 'updated_at'))
        access = self._login()

        get_response = self.client.get(self.url, **self._auth(access))
        patch_response = self.client.patch(
            self.url,
            {'version': 0, 'instruction': 'Текст'},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(get_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(patch_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(AISettings.objects.exists())

    def test_get_returns_spec_defaults_limits_usage_and_etag(self):
        access = self._login()

        response = self.client.get(self.url, **self._auth(access))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response['ETag'], '"0"')
        self.assertEqual(response.data['version'], 0)
        self.assertEqual(response.data['instruction'], '')
        self.assertFalse(response.data['autopilot_enabled'])
        self.assertEqual(response.data['autopilot_mode'], 'fallback')
        self.assertEqual(response.data['autopilot_delay'], 5)
        self.assertEqual(response.data['limits']['daily_deal_creation'], 50)
        self.assertEqual(
            response.data['limits']['hourly_autopilot_replies_per_chat'],
            10,
        )
        self.assertEqual(
            response.data['current_usage']['autopilot_replies_today'],
            0,
        )

    def test_get_returns_persisted_daily_usage(self):
        settings_object = AISettings.objects.create(workspace=self.user.workspace)
        AIUsageDaily.objects.create(
            workspace=self.user.workspace,
            date=timezone.now().date(),
            deals_created=2,
            tasks_created=3,
            contacts_updated=4,
            autopilot_replies=5,
        )
        access = self._login()

        response = self.client.get(self.url, **self._auth(access))

        self.assertEqual(settings_object.version, 0)
        self.assertEqual(
            response.data['current_usage'],
            {
                'deals_today': 2,
                'tasks_today': 3,
                'updates_today': 4,
                'autopilot_replies_today': 5,
            },
        )

    def test_patch_instruction_increments_version_and_writes_audit(self):
        access = self._login()

        response = self.client.patch(
            self.url,
            {'version': 0, 'instruction': '<b>Отвечай кратко</b>'},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['version'], 1)
        self.assertEqual(response['ETag'], '"1"')
        self.assertEqual(response.data['instruction'], '<b>Отвечай кратко</b>')
        audit = AIAuditLog.objects.get()
        self.assertEqual(audit.action, AIAuditAction.INSTRUCTION_UPDATED)
        self.assertEqual(audit.changes['instruction']['old'], '')
        self.assertEqual(
            audit.changes['instruction']['new'],
            '<b>Отвечай кратко</b>',
        )

    def test_empty_instruction_removes_it(self):
        AISettings.objects.create(
            workspace=self.user.workspace,
            instruction='Старая инструкция',
        )
        access = self._login()

        response = self.client.patch(
            self.url,
            {'version': 0, 'instruction': ''},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['instruction'], '')

    def test_patch_autopilot_fields_writes_settings_changed_audit(self):
        access = self._login()

        response = self.client.patch(
            self.url,
            {
                'version': 0,
                'autopilot_enabled': True,
                'autopilot_mode': 'always',
                'autopilot_delay': 3,
            },
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['autopilot_enabled'])
        self.assertEqual(response.data['autopilot_mode'], 'always')
        self.assertEqual(response.data['autopilot_delay'], 3)
        audit = AIAuditLog.objects.get()
        self.assertEqual(
            audit.action,
            AIAuditAction.AUTOPILOT_SETTINGS_CHANGED,
        )
        self.assertEqual(audit.user, self.user)
        self.assertEqual(audit.workspace, self.user.workspace)
        self.assertEqual(
            audit.changes,
            {
                'autopilot_enabled': {'old': False, 'new': True},
                'autopilot_mode': {'old': 'fallback', 'new': 'always'},
                'autopilot_delay': {'old': 5, 'new': 3},
            },
        )

    def test_patch_rejects_invalid_values_and_unknown_fields(self):
        access = self._login()
        payloads = (
            {'version': 0, 'instruction': 'x' * 5001},
            {'version': 0, 'autopilot_mode': 'sometimes'},
            {'version': 0, 'autopilot_delay': 0},
            {'version': 0, 'unknown': True},
        )

        for payload in payloads:
            with self.subTest(payload=payload):
                response = self.client.patch(
                    self.url,
                    payload,
                    format='json',
                    **self._auth(access),
                )
                self.assertEqual(
                    response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertEqual(
                    response.data['error']['code'],
                    'VALIDATION_ERROR',
                )

    def test_patch_requires_version(self):
        access = self._login()

        response = self.client.patch(
            self.url,
            {'instruction': 'Текст'},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patch_returns_version_conflict_without_overwriting(self):
        AISettings.objects.create(
            workspace=self.user.workspace,
            version=2,
            instruction='Актуальная инструкция',
        )
        access = self._login()

        response = self.client.patch(
            self.url,
            {'version': 1, 'instruction': 'Устаревшее изменение'},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['error']['code'], 'VERSION_CONFLICT')
        self.assertEqual(response.data['current_version'], 2)
        self.assertIn('другой вкладке', response.data['error']['message'])
        self.assertEqual(
            AISettings.objects.get().instruction,
            'Актуальная инструкция',
        )
        self.assertFalse(AIAuditLog.objects.exists())

    def test_noop_patch_does_not_increment_version_or_write_audit(self):
        access = self._login()

        response = self.client.patch(
            self.url,
            {'version': 0, 'autopilot_enabled': False},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['version'], 0)
        self.assertFalse(AIAuditLog.objects.exists())

    def test_if_match_must_equal_body_version(self):
        access = self._login()

        response = self.client.patch(
            self.url,
            {'version': 0, 'instruction': 'Текст'},
            format='json',
            HTTP_IF_MATCH='"1"',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['error']['code'],
            'INVALID_VERSION_HEADER',
        )

    def test_settings_are_isolated_by_workspace(self):
        other_user = User.objects.create_user(
            email='other@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        AISettings.objects.create(
            workspace=other_user.workspace,
            instruction='Чужая инструкция',
        )
        access = self._login()

        response = self.client.get(self.url, **self._auth(access))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['instruction'], '')
        self.assertEqual(AISettings.objects.count(), 2)
