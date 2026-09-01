from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from .models import PasswordResetToken, User


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class PasswordResetCancelApiTests(TestCase):
    cancel_url = '/api/auth/reset-password/cancel'

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='OldPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

    def test_cancel_invalidates_latest_unfinished_reset(self):
        token = PasswordResetToken.objects.create(
            user=self.user,
            reset_code_hash='unused',
            code_expires_at=timezone.now() + timedelta(minutes=10),
            confirmed_at=timezone.now(),
        )

        response = self.client.post(
            self.cancel_url,
            {'email': self.user.email},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        token.refresh_from_db()
        self.assertTrue(token.used)
        self.assertIsNone(token.confirmed_at)

    def test_cancel_is_idempotent_when_no_reset_exists(self):
        response = self.client.post(
            self.cancel_url,
            {'email': self.user.email},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)