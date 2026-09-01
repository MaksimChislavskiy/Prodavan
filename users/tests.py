import re
from datetime import timedelta

from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from workspaces.models import Workspace

from .models import (
    AuthAuditAction,
    AuthAuditLog,
    RefreshToken,
    RegistrationToken,
    User,
    UserRole,
)


TEST_SETTINGS = {
    'EMAIL_BACKEND': 'django.core.mail.backends.locmem.EmailBackend',
    'PASSWORD_HASHERS': ['django.contrib.auth.hashers.MD5PasswordHasher'],
}


class UserManagerTests(TestCase):
    def test_create_user_uses_email_as_login_and_creates_workspace(self):
        user = User.objects.create_user(
            email='  OWNER@Example.COM ',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

        self.assertEqual(user.email, 'owner@example.com')
        self.assertIsNone(user.username)
        self.assertTrue(user.check_password('StrongPass1'))
        self.assertEqual(user.role, UserRole.ADMIN)
        self.assertEqual(user.workspace.name, 'Компания Иван Иванов')

    def test_create_user_requires_email(self):
        with self.assertRaisesMessage(ValueError, 'E-mail обязателен.'):
            User.objects.create_user(email='', password='StrongPass1')

    def test_create_user_accepts_existing_workspace(self):
        workspace = Workspace.objects.create(name='ООО Тест')
        user = User.objects.create_user(
            email='user@example.com',
            password='StrongPass1',
            first_name='Пётр',
            last_name='Петров',
            workspace=workspace,
        )

        self.assertEqual(user.workspace, workspace)
        self.assertEqual(Workspace.objects.count(), 1)


class UserModelTests(TestCase):
    def test_soft_delete_deactivates_user_and_sets_timestamp(self):
        user = User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
        )

        user.soft_delete()

        self.assertFalse(user.is_active)
        self.assertIsNotNone(user.deleted_at)


class RegistrationTokenTests(TestCase):
    def test_expired_token_cannot_be_used(self):
        token = RegistrationToken.objects.create(
            email='owner@example.com',
            name='Иван',
            surname='Иванов',
            password_hash='hash',
            confirmation_code_hash='hash',
            code_expires_at=timezone.now() - timedelta(seconds=1),
        )

        self.assertTrue(token.is_expired)
        self.assertFalse(token.can_attempt)

    def test_token_stops_after_five_attempts(self):
        token = RegistrationToken.objects.create(
            email='owner@example.com',
            name='Иван',
            surname='Иванов',
            password_hash='hash',
            confirmation_code_hash='hash',
            code_expires_at=timezone.now() + timedelta(minutes=10),
            attempts=5,
        )

        self.assertFalse(token.can_attempt)

    def test_used_or_confirmed_token_cannot_be_used(self):
        token = RegistrationToken.objects.create(
            email='owner@example.com',
            name='Иван',
            surname='Иванов',
            password_hash='hash',
            confirmation_code_hash='hash',
            code_expires_at=timezone.now() + timedelta(minutes=10),
            used=True,
            is_confirmed=True,
        )

        self.assertFalse(token.can_attempt)


@override_settings(**TEST_SETTINGS)
class RegistrationApiTests(TestCase):
    register_url = '/api/auth/register'
    resend_url = '/api/auth/register/resend'
    expire_url = '/api/auth/register/expire'
    confirm_url = '/api/auth/confirm'

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.payload = {
            'name': 'Иван',
            'surname': 'Иванов',
            'email': 'OWNER@Example.COM',
            'password': 'StrongPass1',
        }

    def _start_registration(self):
        response = self.client.post(self.register_url, self.payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        code = re.search(r'\b([1-9]\d{3})\b', mail.outbox[-1].body).group(1)
        return code

    def test_register_creates_temporary_record_and_sends_code(self):
        response = self.client.post(self.register_url, self.payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['email'], 'owner@example.com')
        self.assertEqual(len(mail.outbox), 1)
        token = RegistrationToken.objects.get(email='owner@example.com')
        self.assertEqual(token.name, 'Иван')
        self.assertEqual(token.attempts, 0)
        self.assertFalse(token.expired)
        self.assertFalse(token.used)
        self.assertFalse(token.is_confirmed)

    def test_reopening_active_registration_does_not_send_new_code(self):
        self._start_registration()
        token = RegistrationToken.objects.get(email='owner@example.com')
        original_code_hash = token.confirmation_code_hash
        original_expires_at = token.code_expires_at

        response = self.client.post(self.register_url, self.payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        token.refresh_from_db()
        self.assertEqual(token.confirmation_code_hash, original_code_hash)
        self.assertEqual(token.code_expires_at, original_expires_at)

    def test_resend_replaces_code_and_resets_attempts(self):
        old_code = self._start_registration()
        token = RegistrationToken.objects.get(email='owner@example.com')
        token.attempts = 5
        token.save(update_fields=('attempts', 'updated_at'))

        response = self.client.post(
            self.resend_url,
            {'email': 'owner@example.com'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 2)
        new_code = re.search(r'\b([1-9]\d{3})\b', mail.outbox[-1].body).group(1)
        self.assertNotEqual(new_code, old_code)
        token.refresh_from_db()
        self.assertEqual(token.attempts, 0)
        self.assertFalse(token.expired)

    def test_expire_registration_marks_token_expired(self):
        self._start_registration()

        response = self.client.post(
            self.expire_url,
            {'email': 'owner@example.com'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        token = RegistrationToken.objects.get(email='owner@example.com')
        self.assertTrue(token.expired)
        self.assertFalse(token.used)

    def test_register_rejects_weak_password(self):
        self.payload['password'] = 'onlyletters'

        response = self.client.post(self.register_url, self.payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('password', response.data)

    def test_register_accepts_password_up_to_255_characters(self):
        self.payload['password'] = 'A1' + ('x' * 253)

        response = self.client.post(self.register_url, self.payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_register_rejects_existing_active_email(self):
        User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
        )

        response = self.client.post(self.register_url, self.payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['email'][0],
            'Пользователь с таким e-mail уже существует.',
        )

    def test_confirm_creates_user_workspace_tokens_and_cookie(self):
        code = self._start_registration()

        response = self.client.post(
            self.confirm_url,
            {'email': 'owner@example.com', 'code': code},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access_token', response.data)
        self.assertEqual(response.data['user']['role'], UserRole.ADMIN)
        user = User.objects.get(email='owner@example.com')
        self.assertTrue(user.is_confirmed)
        self.assertEqual(user.workspace.name, 'Компания Иван Иванов')
        token = RegistrationToken.objects.get(email=user.email)
        self.assertTrue(token.is_confirmed)
        self.assertTrue(token.used)
        self.assertTrue(token.expired)
        self.assertEqual(RefreshToken.objects.filter(user=user).count(), 1)
        self.assertTrue(response.cookies['refresh']['httponly'])
        self.assertEqual(response.cookies['refresh']['samesite'], 'Lax')
        self.assertEqual(
            set(
                AuthAuditLog.objects.filter(successful=True).values_list(
                    'action',
                    flat=True,
                ),
            ),
            {
                AuthAuditAction.REGISTRATION_REQUESTED,
                AuthAuditAction.REGISTRATION_CONFIRMED,
            },
        )

    def test_confirming_used_code_returns_409(self):
        code = self._start_registration()
        first_response = self.client.post(
            self.confirm_url,
            {'email': 'owner@example.com', 'code': code},
            format='json',
        )
        self.assertEqual(first_response.status_code, status.HTTP_200_OK)

        response = self.client.post(
            self.confirm_url,
            {'email': 'owner@example.com', 'code': code},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_confirm_increments_attempts_and_blocks_fifth_error(self):
        self._start_registration()

        for attempt in range(1, 6):
            response = self.client.post(
                self.confirm_url,
                {'email': 'owner@example.com', 'code': '9999'},
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            token = RegistrationToken.objects.get(email='owner@example.com')
            self.assertEqual(token.attempts, attempt)

        self.assertEqual(
            response.data['detail'],
            'Превышено количество попыток. Запросите новый код.',
        )

    def test_confirm_rejects_expired_code(self):
        code = self._start_registration()
        RegistrationToken.objects.filter(email='owner@example.com').update(
            code_expires_at=timezone.now() - timedelta(seconds=1),
        )

        response = self.client.post(
            self.confirm_url,
            {'email': 'owner@example.com', 'code': code},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['detail'],
            'Срок действия кода истёк. Запросите новый код.',
        )

    def test_confirm_returns_404_for_missing_registration(self):
        response = self.client.post(
            self.confirm_url,
            {'email': 'missing@example.com', 'code': '1234'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)