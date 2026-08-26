import uuid

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import Task


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class TaskContractViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='task-contracts@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.client.force_authenticate(self.user)

    def test_create_rejects_non_uuid_idempotency_key(self):
        response = self.client.post(
            '/api/tasks',
            {'title': 'Проверить договор'},
            format='json',
            HTTP_IDEMPOTENCY_KEY='task-create-not-a-uuid',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['errors']['Idempotency-Key'],
            'Заголовок должен содержать UUID.',
        )
        self.assertFalse(Task.objects.exists())

    def test_create_accepts_uuid_idempotency_key(self):
        response = self.client.post(
            '/api/tasks',
            {'title': 'Проверить договор'},
            format='json',
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Task.objects.count(), 1)

    def test_task_list_reports_invalid_limit_as_limit_error(self):
        response = self.client.get('/api/tasks', {'status': 'new', 'limit': 0})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['errors']['limit'],
            'Значение должно быть от 1 до 100.',
        )

    def test_task_history_reports_invalid_limit_as_limit_error(self):
        task = Task.objects.create(
            workspace=self.user.workspace,
            title='Задача с историей',
        )

        response = self.client.get(
            f'/api/tasks/{task.id}/history',
            {'limit': 101},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['errors']['limit'],
            'Значение должно быть от 1 до 100.',
        )

    def test_dashboard_returns_description_and_comment_from_full_task_dto(self):
        Task.objects.create(
            workspace=self.user.workspace,
            title='Задача рабочего стола',
            description='Полное описание',
            comment='Комментарий менеджера',
        )

        response = self.client.get('/api/tasks/dashboard')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['tasks']), 1)
        self.assertEqual(response.data['tasks'][0]['description'], 'Полное описание')
        self.assertEqual(response.data['tasks'][0]['comment'], 'Комментарий менеджера')
