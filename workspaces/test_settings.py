import uuid

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User, UserRole

from .models import (
    IntegrationHealth,
    IntegrationStatus,
    IntegrationType,
    WorkspaceAuditLog,
    WorkspaceIdempotencyRecord,
    WorkspaceIntegration,
)


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class WorkspaceSettingsApiTests(TestCase):
    url = '/api/workspace/settings'
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

    def test_settings_require_authentication(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_get_settings_returns_defaults_and_etag(self):
        access = self._login()

        response = self.client.get(self.url, **self._auth(access))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['timezone'], 'UTC')
        self.assertEqual(response.data['language'], 'ru')
        self.assertEqual(response.data['version'], 0)
        self.assertEqual(response['ETag'], '"0"')
        self.assertEqual(response.data['integrations'], [])

    def test_non_admin_receives_standardized_403(self):
        self.user.role = UserRole.USER
        self.user.save(update_fields=('role', 'updated_at'))
        access = self._login()

        response = self.client.get(self.url, **self._auth(access))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['error']['code'], 'PERMISSION_DENIED')

    def test_patch_timezone_increments_version_and_writes_audit(self):
        access = self._login()

        response = self.client.patch(
            self.url,
            {'version': 0, 'timezone': 'Europe/Moscow'},
            format='json',
            HTTP_IF_MATCH='"0"',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['version'], 1)
        self.assertEqual(response['ETag'], '"1"')
        audit = WorkspaceAuditLog.objects.get(workspace=self.workspace)
        self.assertEqual(audit.field, 'timezone')
        self.assertEqual(audit.old_value, 'UTC')
        self.assertEqual(audit.new_value, 'Europe/Moscow')

    def test_patch_company_supports_partial_update_and_null(self):
        access = self._login()

        response = self.client.patch(
            self.url,
            {
                'version': 0,
                'company': {
                    'full_name': 'ООО Ромашка',
                    'short_name': 'Ромашка',
                    'postal_address': None,
                    'inn': '7707083893',
                    'kpp': '773601001',
                    'ogrn': '1027700132195',
                    'okved': '62.01',
                    'okpo': '00032537',
                },
            },
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['company']['full_name'], 'ООО Ромашка')
        self.assertIsNone(response.data['company']['postal_address'])
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.name, 'ООО Ромашка')
        self.assertEqual(
            WorkspaceAuditLog.objects.filter(workspace=self.workspace).count(),
            7,
        )

    def test_patch_rejects_invalid_timezone_and_inn_with_codes(self):
        access = self._login()
        timezone_response = self.client.patch(
            self.url,
            {'version': 0, 'timezone': 'GMT+3'},
            format='json',
            **self._auth(access),
        )
        inn_response = self.client.patch(
            self.url,
            {'version': 0, 'company': {'inn': '1234567890'}},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(
            timezone_response.data['error']['code'],
            'INVALID_TIMEZONE',
        )
        self.assertEqual(inn_response.data['error']['code'], 'INVALID_INN')

    def test_patch_returns_version_conflict(self):
        access = self._login()
        self.workspace.version = 2
        self.workspace.save(update_fields=('version', 'updated_at'))

        response = self.client.patch(
            self.url,
            {'version': 1, 'timezone': 'Europe/Moscow'},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['error']['code'], 'VERSION_CONFLICT')
        self.assertEqual(response.data['current_version'], 2)

    def test_patch_checks_if_match_against_body_version(self):
        access = self._login()

        response = self.client.patch(
            self.url,
            {'version': 0, 'timezone': 'Europe/Moscow'},
            format='json',
            HTTP_IF_MATCH='"1"',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['error']['code'],
            'INVALID_VERSION_HEADER',
        )

    def test_noop_patch_does_not_increment_version_or_create_audit(self):
        access = self._login()

        response = self.client.patch(
            self.url,
            {'version': 0, 'timezone': 'UTC'},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['version'], 0)
        self.assertFalse(WorkspaceAuditLog.objects.exists())

    def test_patch_rejects_body_larger_than_256_kilobytes(self):
        access = self._login()

        response = self.client.patch(
            self.url,
            {'version': 0, 'padding': 'x' * (256 * 1024)},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )

    def test_idempotency_key_replays_same_response_without_second_update(self):
        access = self._login()
        key = str(uuid.uuid4())
        payload = {'version': 0, 'timezone': 'Europe/Moscow'}

        first = self.client.patch(
            self.url,
            payload,
            format='json',
            HTTP_IDEMPOTENCY_KEY=key,
            **self._auth(access),
        )
        second = self.client.patch(
            self.url,
            payload,
            format='json',
            HTTP_IDEMPOTENCY_KEY=key,
            **self._auth(access),
        )

        self.assertEqual(first.data, second.data)
        self.assertEqual(second['Idempotency-Replayed'], 'true')
        self.assertEqual(WorkspaceAuditLog.objects.count(), 1)
        self.assertEqual(WorkspaceIdempotencyRecord.objects.count(), 1)

    def test_idempotency_key_rejects_different_request(self):
        access = self._login()
        key = str(uuid.uuid4())
        self.client.patch(
            self.url,
            {'version': 0, 'timezone': 'Europe/Moscow'},
            format='json',
            HTTP_IDEMPOTENCY_KEY=key,
            **self._auth(access),
        )

        response = self.client.patch(
            self.url,
            {'version': 0, 'timezone': 'Asia/Yekaterinburg'},
            format='json',
            HTTP_IDEMPOTENCY_KEY=key,
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(
            response.data['error']['code'],
            'IDEMPOTENCY_KEY_REUSED',
        )

    def test_get_integrations_never_exposes_config_secret(self):
        WorkspaceIntegration.objects.create(
            workspace=self.workspace,
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
            health_status=IntegrationHealth.HEALTHY,
            config={'bot_token': 'super-secret'},
            bot_username='@my_bot',
        )
        access = self._login()

        response = self.client.get(self.url, **self._auth(access))

        integration = response.data['integrations'][0]
        self.assertEqual(integration['bot_username'], '@my_bot')
        self.assertNotIn('config', integration)
