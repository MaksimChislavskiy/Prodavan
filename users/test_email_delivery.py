import json
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from .email_delivery import (
    MAX_RETRY_ATTEMPTS,
    deliver_or_enqueue_auth_email,
    process_auth_email_delivery,
)
from .models import (
    AuthEmailDelivery,
    AuthEmailDeliveryStatus,
    AuthEmailPurpose,
)


class AuthEmailDeliveryTests(TestCase):
    def _enqueue(self):
        with patch('users.email_delivery._send', side_effect=OSError('offline')):
            return deliver_or_enqueue_auth_email(
                recipient='owner@example.com',
                purpose=AuthEmailPurpose.REGISTRATION,
                subject='Код регистрации',
                message='Секретный код: 1234',
                expires_at=timezone.now() + timedelta(minutes=10),
            )

    def test_successful_initial_delivery_does_not_create_queue_record(self):
        with patch('users.email_delivery._send') as send:
            result = deliver_or_enqueue_auth_email(
                recipient='owner@example.com',
                purpose=AuthEmailPurpose.REGISTRATION,
                subject='Код регистрации',
                message='Секретный код: 1234',
                expires_at=timezone.now() + timedelta(minutes=10),
            )

        self.assertIsNone(result)
        send.assert_called_once()
        self.assertFalse(AuthEmailDelivery.objects.exists())

    def test_failed_delivery_is_queued_encrypted_and_retried(self):
        delivery = self._enqueue()
        serialized_payload = json.dumps(delivery.encrypted_payload)

        self.assertEqual(delivery.status, AuthEmailDeliveryStatus.PENDING)
        self.assertNotIn('owner@example.com', serialized_payload)
        self.assertNotIn('1234', serialized_payload)

        with patch('users.email_delivery._send') as send:
            processed = process_auth_email_delivery(
                delivery.id,
                now=delivery.next_attempt_at,
            )

        self.assertTrue(processed)
        send.assert_called_once_with(
            recipient='owner@example.com',
            subject='Код регистрации',
            message='Секретный код: 1234',
        )
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, AuthEmailDeliveryStatus.SENT)
        self.assertEqual(delivery.attempts, 1)
        self.assertIsNotNone(delivery.sent_at)

    def test_worker_stops_after_three_retry_attempts(self):
        delivery = self._enqueue()

        with patch('users.email_delivery._send', side_effect=OSError('offline')):
            for _ in range(MAX_RETRY_ATTEMPTS):
                delivery.refresh_from_db()
                self.assertTrue(
                    process_auth_email_delivery(
                        delivery.id,
                        now=delivery.next_attempt_at,
                    ),
                )

        delivery.refresh_from_db()
        self.assertEqual(delivery.attempts, MAX_RETRY_ATTEMPTS)
        self.assertEqual(delivery.status, AuthEmailDeliveryStatus.FAILED)
        self.assertIsNone(delivery.next_attempt_at)

    def test_worker_does_not_send_expired_code(self):
        delivery = self._enqueue()
        now = timezone.now()
        AuthEmailDelivery.objects.filter(id=delivery.id).update(
            expires_at=now - timedelta(seconds=1),
            next_attempt_at=now,
        )

        with patch('users.email_delivery._send') as send:
            processed = process_auth_email_delivery(delivery.id, now=now)

        self.assertTrue(processed)
        send.assert_not_called()
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, AuthEmailDeliveryStatus.EXPIRED)


class PasswordHashingTests(TestCase):
    def test_default_password_hasher_is_bcrypt_with_cost_at_least_ten(self):
        from django.contrib.auth.hashers import identify_hasher

        from .models import User

        user = User.objects.create_user(
            email='bcrypt@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

        hasher = identify_hasher(user.password)
        self.assertEqual(hasher.algorithm, 'bcrypt_sha256')
        self.assertGreaterEqual(hasher.rounds, 10)
