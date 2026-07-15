from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.utils import timezone

from users.models import User

from .maintenance import close_inactive_chat_sessions
from .models import AIChatSession, AIChatSessionStatus


class AIChatMaintenanceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

    def _session(self, **overrides):
        defaults = {
            'workspace': self.user.workspace,
            'user': self.user,
        }
        defaults.update(overrides)
        return AIChatSession.objects.create(**defaults)

    def test_close_inactive_sessions_preserves_history_and_other_states(self):
        now = timezone.now()
        cutoff = now - timedelta(minutes=30)
        inactive = self._session(last_activity_at=cutoff - timedelta(seconds=1))
        at_cutoff = self._session(last_activity_at=cutoff)
        active = self._session(last_activity_at=cutoff + timedelta(seconds=1))
        previous_closed_at = now - timedelta(days=1)
        already_closed = self._session(
            status=AIChatSessionStatus.CLOSED,
            last_activity_at=cutoff - timedelta(days=1),
            closed_at=previous_closed_at,
        )
        soft_deleted = self._session(
            last_activity_at=cutoff - timedelta(days=1),
            deleted_at=now - timedelta(days=1),
        )

        closed = close_inactive_chat_sessions(
            now=now,
            idle_minutes=30,
            batch_size=1,
        )

        self.assertEqual(closed, 2)
        for session in (inactive, at_cutoff):
            session.refresh_from_db()
            self.assertEqual(session.status, AIChatSessionStatus.CLOSED)
            self.assertEqual(session.closed_at, now)
        active.refresh_from_db()
        self.assertEqual(active.status, AIChatSessionStatus.OPEN)
        already_closed.refresh_from_db()
        self.assertEqual(already_closed.closed_at, previous_closed_at)
        soft_deleted.refresh_from_db()
        self.assertEqual(soft_deleted.status, AIChatSessionStatus.OPEN)
        self.assertEqual(AIChatSession.objects.count(), 5)

    @override_settings(AI_CHAT_SESSION_IDLE_MINUTES=45)
    def test_default_idle_timeout_comes_from_settings(self):
        now = timezone.now()
        session = self._session(
            last_activity_at=now - timedelta(minutes=44, seconds=59),
        )

        self.assertEqual(close_inactive_chat_sessions(now=now), 0)
        session.last_activity_at = now - timedelta(minutes=45)
        session.save(update_fields=('last_activity_at', 'updated_at'))
        self.assertEqual(close_inactive_chat_sessions(now=now), 1)

    def test_service_and_command_validate_options(self):
        with self.assertRaisesRegex(ValueError, 'idle_minutes'):
            close_inactive_chat_sessions(idle_minutes=0)
        with self.assertRaisesRegex(ValueError, 'batch_size'):
            close_inactive_chat_sessions(batch_size=0)
        with self.assertRaises(CommandError):
            call_command('close_inactive_ai_chat_sessions', idle_minutes=0)
        with self.assertRaises(CommandError):
            call_command('close_inactive_ai_chat_sessions', batch_size=0)

    def test_management_command_reports_closed_count(self):
        self._session(last_activity_at=timezone.now() - timedelta(hours=1))
        stdout = StringIO()

        call_command(
            'close_inactive_ai_chat_sessions',
            idle_minutes=30,
            batch_size=1,
            stdout=stdout,
        )

        self.assertIn('AI-chat сессий: 1', stdout.getvalue())
