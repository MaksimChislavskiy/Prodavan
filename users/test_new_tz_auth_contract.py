from datetime import timedelta

from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from .models import PasswordResetToken, User


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class NewAuthTzContractTests(TestCase):
    forgot_url = '/api/auth/forgot-password'
    confirm_reset_url = '/api/auth/reset-password/confirm'
    reset_url = '/api/auth/reset-password'

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

    def test_password_reset_confirmation_is_valid_for_fifteen_minutes(self):
        token = PasswordResetToken.objects.create(
            user=self.user,
            reset_code_hash='unused',
            code_expires_at=timezone.now() - timedelta(minutes=1),
            confirmed_at=timezone.now() - timedelta(minutes=14),
        )

        response = self.client.post(
            self.reset_url,
            {'email': self.user.email, 'new_password': 'NewPass1'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        token.refresh_from_db()
        self.assertTrue(token.used)

    def test_password_reset_confirmation_expires_after_fifteen_minutes(self):
        token = PasswordResetToken.objects.create(
            user=self.user,
            reset_code_hash='unused',
            code_expires_at=timezone.now() + timedelta(minutes=1),
            confirmed_at=timezone.now() - timedelta(minutes=16),
        )

        response = self.client.post(
            self.reset_url,
            {'email': self.user.email, 'new_password': 'NewPass1'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['detail'],
            'Срок восстановления истёк. Пройдите процедуру восстановления заново.',
        )
        token.refresh_from_db()
        self.assertTrue(token.used)
        self.assertIsNone(token.confirmed_at)

    def test_password_reset_email_matches_new_tz_copy(self):
        response = self.client.post(
            self.forgot_url,
            {'email': self.user.email},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(mail.outbox[-1].subject, 'Восстановление пароля в CRM Продаван')
        self.assertIn('Ваш код для восстановления пароля:', mail.outbox[-1].body)
        self.assertIn('Код действителен в течение 10 минут.', mail.outbox[-1].body)