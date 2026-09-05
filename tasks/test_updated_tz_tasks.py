import uuid
from zoneinfo import ZoneInfo

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from tasks.models import DueDateType, Task
from users.models import User


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class UpdatedTaskDueDateContractTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='updated-task-contract@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.user.workspace.timezone = 'Europe/Moscow'
        self.user.workspace.save(update_fields=('timezone', 'updated_at'))
        self.client.force_authenticate(self.user)

    def create_task(self, payload):
        return self.client.post(
            '/api/tasks',
            payload,
            format='json',
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )

    def test_create_infers_date_type_for_local_midnight(self):
        response = self.create_task({
            'title': 'Позвонить клиенту',
            'due_date': '2026-06-20T00:00',
        })

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['due_date_type'], DueDateType.DATE)
        task = Task.objects.get(id=response.data['id'])
        local_due = task.due_date.astimezone(ZoneInfo('Europe/Moscow'))
        self.assertEqual((local_due.hour, local_due.minute), (0, 0))

    def test_create_infers_datetime_type_for_non_midnight_time(self):
        response = self.create_task({
            'title': 'Встреча',
            'due_date': '2026-06-20T15:30',
        })

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['due_date_type'], DueDateType.DATETIME)

    def test_update_infers_due_date_type_when_type_is_omitted(self):
        created = self.create_task({'title': 'Встреча'})
        response = self.client.patch(
            f"/api/tasks/{created.data['id']}",
            {
                'version': created.data['version'],
                'due_date': '2026-06-21T00:00',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['due_date_type'], DueDateType.DATE)

    def test_update_requires_none_type_when_due_date_is_cleared(self):
        created = self.create_task({
            'title': 'Встреча',
            'due_date': '2026-06-20T15:30',
        })
        invalid = self.client.patch(
            f"/api/tasks/{created.data['id']}",
            {
                'version': created.data['version'],
                'due_date': None,
            },
            format='json',
        )
        valid = self.client.patch(
            f"/api/tasks/{created.data['id']}",
            {
                'version': created.data['version'],
                'due_date': None,
                'due_date_type': DueDateType.NONE,
            },
            format='json',
        )

        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(valid.status_code, status.HTTP_200_OK)
        self.assertIsNone(valid.data['due_date'])
        self.assertEqual(valid.data['due_date_type'], DueDateType.NONE)
