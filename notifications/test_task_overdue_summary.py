from datetime import datetime, timedelta, timezone as datetime_timezone

from django.test import TestCase, override_settings

from tasks.models import DueDateType, Task, TaskStatus
from users.models import User
from users.services import issue_token_pair

from .models import Notification, NotificationType
from .task_deadlines import (
    OVERDUE_SUMMARY_ENTITY_TYPE,
    create_overdue_task_summary_notifications,
    sync_overdue_task_summary_for_user,
)


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class OverdueTaskSummaryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='overdue-summary@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.workspace = self.user.workspace
        self.workspace.timezone = 'Europe/Moscow'
        self.workspace.save(update_fields=('timezone', 'updated_at'))
        self.now = datetime(2026, 8, 26, 6, 15, tzinfo=datetime_timezone.utc)

    def _task(self, *, title, due_date, due_date_type=DueDateType.DATETIME, status=TaskStatus.NEW):
        return Task.objects.create(
            workspace=self.workspace,
            title=title,
            due_date=due_date,
            due_date_type=due_date_type,
            status=status,
            created_by_user=self.user,
        )

    def _summary(self):
        return Notification.objects.filter(
            user=self.user,
            type=NotificationType.TASK_OVERDUE,
            entity_type=OVERDUE_SUMMARY_ENTITY_TYPE,
            is_deleted=False,
        ).first()

    def test_summary_is_created_and_updated_when_overdue_count_changes(self):
        self._task(
            title='Перезвонить клиенту',
            due_date=self.now - timedelta(minutes=1),
        )

        changed = sync_overdue_task_summary_for_user(self.user, now=self.now)

        self.assertEqual(changed, 1)
        summary = self._summary()
        self.assertIsNotNone(summary)
        self.assertEqual(summary.content, 'У вас 1 просроченных задач')
        summary_id = summary.id

        self._task(
            title='Отправить КП',
            due_date=self.now - timedelta(days=1),
            due_date_type=DueDateType.DATE,
        )
        changed = sync_overdue_task_summary_for_user(self.user, now=self.now)

        self.assertEqual(changed, 1)
        summary = self._summary()
        self.assertEqual(summary.id, summary_id)
        self.assertEqual(summary.content, 'У вас 2 просроченных задач')
        self.assertFalse(summary.is_read)

    def test_summary_ignores_completed_and_not_yet_overdue_date_tasks(self):
        self._task(
            title='Выполненная',
            due_date=self.now - timedelta(days=1),
            status=TaskStatus.DONE,
        )
        # 21:00 UTC previous day is midnight of the current Moscow local day,
        # therefore a date-only task is not overdue until the next local day starts.
        self._task(
            title='Сегодня',
            due_date=datetime(2026, 8, 25, 21, 0, tzinfo=datetime_timezone.utc),
            due_date_type=DueDateType.DATE,
        )

        changed = sync_overdue_task_summary_for_user(self.user, now=self.now)

        self.assertEqual(changed, 0)
        self.assertIsNone(self._summary())

    def test_summary_is_removed_when_no_overdue_tasks_remain(self):
        task = self._task(
            title='Закрыть вопрос',
            due_date=self.now - timedelta(hours=1),
        )
        sync_overdue_task_summary_for_user(self.user, now=self.now)
        self.assertIsNotNone(self._summary())

        task.status = TaskStatus.DONE
        task.save(update_fields=('status', 'updated_at'))
        changed = sync_overdue_task_summary_for_user(self.user, now=self.now)

        self.assertEqual(changed, 1)
        self.assertIsNone(self._summary())

    def test_scheduled_check_runs_only_during_workspace_local_nine_oclock_hour(self):
        self._task(
            title='Просроченная',
            due_date=self.now - timedelta(hours=1),
        )

        before_nine = datetime(2026, 8, 26, 5, 59, tzinfo=datetime_timezone.utc)
        result = create_overdue_task_summary_notifications(now=before_nine)
        self.assertEqual(result['workspaces_checked'], 0)
        self.assertIsNone(self._summary())

        result = create_overdue_task_summary_notifications(now=self.now)
        self.assertEqual(result['workspaces_checked'], 1)
        self.assertEqual(result['summaries_changed'], 1)
        self.assertEqual(self._summary().content, 'У вас 1 просроченных задач')

    def test_new_refresh_session_triggers_first_login_overdue_check(self):
        self._task(
            title='Просроченная при входе',
            due_date=datetime.now(tz=datetime_timezone.utc) - timedelta(hours=1),
        )

        with self.captureOnCommitCallbacks(execute=True):
            issue_token_pair(self.user)

        summary = self._summary()
        self.assertIsNotNone(summary)
        self.assertEqual(summary.content, 'У вас 1 просроченных задач')
