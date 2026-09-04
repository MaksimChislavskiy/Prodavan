from datetime import datetime, timedelta, timezone as datetime_timezone
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import DueDateType, Task, TaskStatus


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class DashboardContractTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='dashboard@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.user.workspace.timezone = 'Europe/Moscow'
        self.user.workspace.save(update_fields=('timezone', 'updated_at'))
        self.client.force_authenticate(self.user)
        self.fixed_now = datetime(
            2026,
            6,
            17,
            9,
            0,
            tzinfo=datetime_timezone.utc,
        )

    def _get_dashboard(self):
        with (
            patch('tasks.views.timezone.now', return_value=self.fixed_now),
            patch('tasks.dates.timezone.now', return_value=self.fixed_now),
        ):
            return self.client.get('/api/tasks/dashboard')

    def test_dashboard_uses_exact_priority_groups_and_stable_ordering(self):
        overdue_date = Task.objects.create(
            workspace=self.user.workspace,
            title='Старая просрочка',
            due_date=datetime(2026, 6, 15, 21, tzinfo=datetime_timezone.utc),
            due_date_type=DueDateType.DATE,
        )
        overdue_datetime = Task.objects.create(
            workspace=self.user.workspace,
            title='Просрочка сегодня по времени',
            due_date=datetime(2026, 6, 17, 8, tzinfo=datetime_timezone.utc),
            due_date_type=DueDateType.DATETIME,
        )
        today_datetime = Task.objects.create(
            workspace=self.user.workspace,
            title='Сегодня по времени',
            due_date=datetime(2026, 6, 17, 10, tzinfo=datetime_timezone.utc),
            due_date_type=DueDateType.DATETIME,
        )
        today_date_old = Task.objects.create(
            workspace=self.user.workspace,
            title='Сегодня дата старее',
            due_date=datetime(2026, 6, 16, 21, tzinfo=datetime_timezone.utc),
            due_date_type=DueDateType.DATE,
        )
        today_date_new = Task.objects.create(
            workspace=self.user.workspace,
            title='Сегодня дата новее',
            due_date=datetime(2026, 6, 16, 21, tzinfo=datetime_timezone.utc),
            due_date_type=DueDateType.DATE,
        )
        no_due = Task.objects.create(
            workspace=self.user.workspace,
            title='Без срока',
            due_date_type=DueDateType.NONE,
        )
        Task.objects.filter(id=today_date_old.id).update(
            created_at=self.fixed_now - timedelta(hours=2),
        )
        Task.objects.filter(id=today_date_new.id).update(
            created_at=self.fixed_now - timedelta(hours=1),
        )

        Task.objects.create(
            workspace=self.user.workspace,
            title='Завтра',
            due_date=datetime(2026, 6, 17, 22, tzinfo=datetime_timezone.utc),
            due_date_type=DueDateType.DATETIME,
        )
        Task.objects.create(
            workspace=self.user.workspace,
            title='Выполненная',
            status=TaskStatus.DONE,
            due_date_type=DueDateType.NONE,
        )

        response = self._get_dashboard()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total_count'], 6)
        self.assertEqual(
            [item['id'] for item in response.data['tasks']],
            [
                str(overdue_date.id),
                str(overdue_datetime.id),
                str(today_datetime.id),
                str(today_date_new.id),
                str(today_date_old.id),
                str(no_due.id),
            ],
        )
        self.assertTrue(response.data['tasks'][0]['is_overdue'])
        self.assertTrue(response.data['tasks'][1]['is_overdue'])
        self.assertFalse(response.data['tasks'][2]['is_overdue'])
        self.assertFalse(response.data['tasks'][3]['is_overdue'])

    def test_dashboard_returns_only_first_ten_and_preserves_total_count(self):
        for index in range(12):
            Task.objects.create(
                workspace=self.user.workspace,
                title=f'Без срока {index:02d}',
                due_date_type=DueDateType.NONE,
            )

        response = self._get_dashboard()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total_count'], 12)
        self.assertEqual(len(response.data['tasks']), 10)

    def test_dashboard_contract_includes_description_and_is_workspace_scoped(self):
        own = Task.objects.create(
            workspace=self.user.workspace,
            title='Своя задача',
            description='Описание для рабочего стола',
            due_date_type=DueDateType.NONE,
        )
        other = User.objects.create_user(
            email='other-dashboard@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        Task.objects.create(
            workspace=other.workspace,
            title='Чужая задача',
            due_date_type=DueDateType.NONE,
        )

        response = self._get_dashboard()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total_count'], 1)
        self.assertEqual(response.data['tasks'][0]['id'], str(own.id))
        self.assertEqual(
            response.data['tasks'][0]['description'],
            'Описание для рабочего стола',
        )

    def test_dashboard_requires_authentication(self):
        response = APIClient().get('/api/tasks/dashboard')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
