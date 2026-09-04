import math
from time import perf_counter

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import DueDateType, Task


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class NewTzDashboardNfrTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='dashboard-nfr@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

        for index in range(10):
            Task.objects.create(
                workspace=self.user.workspace,
                title=f'Задача рабочего стола {index:02d}',
                due_date_type=DueDateType.NONE,
            )

    def test_dashboard_application_p95_is_within_one_second(self):
        warmup = self.client.get('/api/tasks/dashboard')
        self.assertEqual(warmup.status_code, status.HTTP_200_OK)
        self.assertEqual(len(warmup.data['tasks']), 10)

        samples = []
        for _ in range(20):
            started = perf_counter()
            response = self.client.get('/api/tasks/dashboard')
            samples.append(perf_counter() - started)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(len(response.data['tasks']), 10)

        ordered = sorted(samples)
        p95 = ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]
        self.assertLessEqual(
            p95,
            1.0,
            f'GET /api/tasks/dashboard application p95 is {p95:.3f}s',
        )
