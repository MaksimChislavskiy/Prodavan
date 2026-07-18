import hashlib
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from .maintenance import cleanup_expired_auth_records
from .models import (
    AuthAuditAction,
    AuthAuditLog,
    AuthEmailDelivery,
    AuthEmailDeliveryStatus,
    AuthEmailPurpose,
    DeletedEmailReservation,
    PasswordResetToken,
    RefreshToken,
    RegistrationToken,
    User,
)


class AuthMaintenanceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

    def test_cleanup_deletes_only_terminal_records_in_batches(self):
        now = timezone.now()
        expired_registration = RegistrationToken.objects.create(
            email='expired@example.com',
            name='Иван',
            surname='Иванов',
            password_hash='password-hash',
            confirmation_code_hash='code-hash',
            code_expires_at=now - timedelta(seconds=1),
        )
        active_registration = RegistrationToken.objects.create(
            email='active@example.com',
            name='Пётр',
            surname='Петров',
            password_hash='password-hash',
            confirmation_code_hash='code-hash',
            code_expires_at=now + timedelta(minutes=10),
        )
        expired_reset = PasswordResetToken.objects.create(
            user=self.user,
            reset_code_hash='expired',
            code_expires_at=now - timedelta(seconds=1),
        )
        used_reset = PasswordResetToken.objects.create(
            user=self.user,
            reset_code_hash='used',
            code_expires_at=now + timedelta(minutes=10),
            used=True,
        )
        active_reset = PasswordResetToken.objects.create(
            user=self.user,
            reset_code_hash='active',
            code_expires_at=now + timedelta(minutes=10),
        )
        expired_refresh = RefreshToken.objects.create(
            user=self.user,
            token_hash='expired-refresh',
            expires_at=now - timedelta(seconds=1),
        )
        revoked_refresh = RefreshToken.objects.create(
            user=self.user,
            token_hash='revoked-refresh',
            expires_at=now + timedelta(days=1),
            revoked=True,
            revoked_at=now,
        )
        active_refresh = RefreshToken.objects.create(
            user=self.user,
            token_hash='active-refresh',
            expires_at=now + timedelta(days=1),
        )
        released_reservation = DeletedEmailReservation.objects.create(
            email_hash=hashlib.sha256(b'released@example.com').hexdigest(),
            user_identifier=self.user.id,
            deleted_at=now - timedelta(days=31),
            release_at=now - timedelta(seconds=1),
        )
        active_reservation = DeletedEmailReservation.objects.create(
            email_hash=hashlib.sha256(b'active@example.com').hexdigest(),
            user_identifier=self.user.id,
            deleted_at=now,
            release_at=now + timedelta(days=30),
        )
        old_email_delivery = AuthEmailDelivery.objects.create(
            recipient_hash=hashlib.sha256(b'old@example.com').hexdigest(),
            purpose=AuthEmailPurpose.REGISTRATION,
            encrypted_payload={'encrypted': True},
            status=AuthEmailDeliveryStatus.SENT,
            attempts=1,
            expires_at=now - timedelta(days=31),
            sent_at=now - timedelta(days=31),
        )
        AuthEmailDelivery.objects.filter(id=old_email_delivery.id).update(
            updated_at=now - timedelta(days=31),
        )
        recent_email_delivery = AuthEmailDelivery.objects.create(
            recipient_hash=hashlib.sha256(b'recent@example.com').hexdigest(),
            purpose=AuthEmailPurpose.PASSWORD_RESET,
            encrypted_payload={'encrypted': True},
            status=AuthEmailDeliveryStatus.SENT,
            attempts=1,
            expires_at=now - timedelta(days=1),
            sent_at=now - timedelta(days=1),
        )
        old_audit = AuthAuditLog.objects.create(
            user=self.user,
            user_identifier=self.user.id,
            email_hash=hashlib.sha256(self.user.email.encode()).hexdigest(),
            action=AuthAuditAction.LOGIN,
            successful=True,
        )
        AuthAuditLog.objects.filter(id=old_audit.id).update(
            created_at=now - timedelta(days=367),
        )
        recent_audit = AuthAuditLog.objects.create(
            user=self.user,
            user_identifier=self.user.id,
            email_hash=hashlib.sha256(self.user.email.encode()).hexdigest(),
            action=AuthAuditAction.LOGIN,
            successful=True,
        )

        counters = cleanup_expired_auth_records(now=now, batch_size=1)

        self.assertEqual(
            counters,
            {
                'registration_tokens': 1,
                'password_reset_tokens': 2,
                'refresh_tokens': 2,
                'email_reservations': 1,
                'auth_email_deliveries': 1,
                'auth_audit_logs': 1,
                'total': 8,
            },
        )
        for deleted in (
            expired_registration,
            expired_reset,
            used_reset,
            expired_refresh,
            revoked_refresh,
            released_reservation,
            old_email_delivery,
            old_audit,
        ):
            self.assertFalse(type(deleted).objects.filter(pk=deleted.pk).exists())
        for retained in (
            active_registration,
            active_reset,
            active_refresh,
            active_reservation,
            recent_email_delivery,
            recent_audit,
        ):
            self.assertTrue(type(retained).objects.filter(pk=retained.pk).exists())

    def test_cleanup_rejects_invalid_batch_size(self):
        with self.assertRaisesRegex(ValueError, 'batch_size'):
            cleanup_expired_auth_records(batch_size=0)

    def test_management_command_reports_counts_and_validates_batch_size(self):
        now = timezone.now()
        RegistrationToken.objects.create(
            email='expired@example.com',
            name='Иван',
            surname='Иванов',
            password_hash='password-hash',
            confirmation_code_hash='code-hash',
            code_expires_at=now - timedelta(seconds=1),
        )
        stdout = StringIO()

        call_command('cleanup_auth_records', batch_size=1, stdout=stdout)

        self.assertIn('registration=1', stdout.getvalue())
        self.assertIn('email_deliveries=0', stdout.getvalue())
        self.assertIn('audit_logs=0', stdout.getvalue())
        self.assertIn('total=1', stdout.getvalue())
        with self.assertRaises(CommandError):
            call_command('cleanup_auth_records', batch_size=0)
