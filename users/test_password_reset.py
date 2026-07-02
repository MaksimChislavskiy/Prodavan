import re
from datetime import timedelta

from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from .models import PasswordResetToken, RefreshToken, User


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class PasswordResetApiTests(TestCase):
    forgot_url = '/api/auth/forgot-password'
    confirm_url = '/api/auth/reset-password/confirm'
    reset_url = '/api/auth/reset-password'
    login_url = '/api/auth/login'
    refresh_url = '/api/auth/refresh'
    me_url = '/api/auth/me'

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='OldPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

    def _request_code(self):
        response = self.client.post(
            self.forgot_url,
            {'email': 'owner@example.com'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return re.search(r'\b([1-9]\d{3})\b', mail.outbox[-1].body).group(1)

    def _confirm_code(self, code):
        response = self.client.post(
            self.confirm_url,
            {'email': 'owner@example.com', 'code': code},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response

    def _login(self):
        response = self.client.post(
            self.login_url,
            {'email': 'owner@example.com', 'password': 'OldPass1'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response

    def test_forgot_password_sends_code_and_creates_token(self):
        code = self._request_code()

        token = PasswordResetToken.objects.get(user=self.user, used=False)
        self.assertRegex(code, r'^[1-9]\d{3}$')
        self.assertEqual(token.attempts, 0)
        self.assertIsNone(token.confirmed_at)

    def test_forgot_password_returns_404_for_unknown_email(self):
        response = self.client.post(
            self.forgot_url,
            {'email': 'missing@example.com'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_forgot_password_is_limited_to_five_requests_per_hour(self):
        for _ in range(5):
            response = self.client.post(
                self.forgot_url,
                {'email': 'owner@example.com'},
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.post(
            self.forgot_url,
            {'email': 'owner@example.com'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_confirm_code_marks_token_as_confirmed(self):
        code = self._request_code()

        response = self._confirm_code(code)

        self.assertEqual(response.data['message'], 'Код подтверждён')
        token = PasswordResetToken.objects.get(user=self.user, used=False)
        self.assertIsNotNone(token.confirmed_at)

    def test_confirm_code_persists_five_failed_attempts(self):
        code = self._request_code()
        wrong_code = '1000' if code != '1000' else '1001'

        for attempt in range(1, 6):
            response = self.client.post(
                self.confirm_url,
                {'email': 'owner@example.com', 'code': wrong_code},
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            token = PasswordResetToken.objects.get(user=self.user, used=False)
            self.assertEqual(token.attempts, attempt)

        self.assertEqual(
            response.data['detail'],
            'Превышено количество попыток. Запросите новый код.',
        )

    def test_confirm_rejects_expired_code(self):
        code = self._request_code()
        PasswordResetToken.objects.filter(user=self.user, used=False).update(
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

    def test_reset_requires_confirmed_code(self):
        self._request_code()

        response = self.client.post(
            self.reset_url,
            {'email': 'owner@example.com', 'new_password': 'NewPass1'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['detail'],
            'Код восстановления не подтверждён.',
        )

    def test_reset_changes_password_and_invalidates_all_sessions(self):
        login_response = self._login()
        old_access = login_response.data['access_token']
        code = self._request_code()
        self._confirm_code(code)

        response = self.client.post(
            self.reset_url,
            {'email': 'owner@example.com', 'new_password': 'NewPass1'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('NewPass1'))
        self.assertEqual(self.user.token_version, 1)
        self.assertTrue(
            PasswordResetToken.objects.get(user=self.user).used,
        )
        self.assertFalse(
            RefreshToken.objects.filter(user=self.user, revoked=False).exists(),
        )

        me_response = self.client.get(
            self.me_url,
            HTTP_AUTHORIZATION=f'Bearer {old_access}',
        )
        self.assertEqual(me_response.status_code, status.HTTP_401_UNAUTHORIZED)

        refresh_response = self.client.post(self.refresh_url, {}, format='json')
        self.assertEqual(
            refresh_response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_reset_rejects_weak_password(self):
        code = self._request_code()
        self._confirm_code(code)

        response = self.client.post(
            self.reset_url,
            {'email': 'owner@example.com', 'new_password': 'onlyletters'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('new_password', response.data)
