from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import Notification, NotificationType
from .services import create_notification


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class NotificationsApiTests(TestCase):
    notifications_url = '/api/notifications'
    unread_count_url = '/api/notifications/unread-count'
    mark_all_read_url = '/api/notifications/mark-all-read'
    login_url = '/api/auth/login'

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.other = User.objects.create_user(
            email='other@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )

    def _login(self):
        response = self.client.post(
            self.login_url,
            {'email': 'owner@example.com', 'password': 'StrongPass1'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data['access_token']

    @staticmethod
    def _auth(access):
        return {'HTTP_AUTHORIZATION': f'Bearer {access}'}

    def _notification(self, **overrides):
        defaults = {
            'workspace': self.user.workspace,
            'user': self.user,
            'type': NotificationType.AI_TASK_CREATED,
            'title': 'AI создал задачу',
            'content': 'Задача создана по переписке.',
            'link': '/tasks/123',
            'entity_type': 'task',
            'entity_id': '123',
        }
        defaults.update(overrides)
        return Notification.objects.create(**defaults)

    def test_notifications_require_authentication(self):
        self.assertEqual(
            self.client.get(self.notifications_url).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(
            self.client.get(self.unread_count_url).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_list_is_paginated_sorted_and_counts_unread(self):
        base = timezone.now() - timedelta(minutes=5)
        notifications = [
            self._notification(title=f'Уведомление {index}')
            for index in range(3)
        ]
        for index, notification in enumerate(notifications):
            Notification.objects.filter(id=notification.id).update(
                created_at=base + timedelta(seconds=index),
            )
        deleted = self._notification(title='Удалённое')
        Notification.objects.filter(id=deleted.id).update(
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        access = self._login()

        first = self.client.get(
            self.notifications_url,
            {'limit': 2},
            **self._auth(access),
        )
        second = self.client.get(
            self.notifications_url,
            {'limit': 2, 'cursor': first.data['next_cursor']},
            **self._auth(access),
        )
        count = self.client.get(self.unread_count_url, **self._auth(access))

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertTrue(first.data['has_more'])
        self.assertEqual(
            [item['title'] for item in first.data['notifications']],
            ['Уведомление 2', 'Уведомление 1'],
        )
        self.assertEqual(len(second.data['notifications']), 1)
        self.assertFalse(second.data['has_more'])
        self.assertEqual(count.data['unread_count'], 3)

    def test_mark_read_only_own_notification(self):
        notification = self._notification()
        other_notification = self._notification(
            workspace=self.other.workspace,
            user=self.other,
        )
        access = self._login()

        response = self.client.patch(
            f'{self.notifications_url}/{notification.id}/read',
            **self._auth(access),
        )
        forbidden = self.client.patch(
            f'{self.notifications_url}/{other_notification.id}/read',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        notification.refresh_from_db()
        self.assertTrue(notification.is_read)
        self.assertIsNotNone(notification.read_at)
        self.assertEqual(forbidden.status_code, status.HTTP_404_NOT_FOUND)

    def test_mark_all_read_single_delete_and_delete_all_are_soft(self):
        first = self._notification()
        second = self._notification(title='Второе уведомление')
        third = self._notification(title='Третье уведомление')
        access = self._login()

        marked = self.client.post(
            self.mark_all_read_url,
            **self._auth(access),
        )
        deleted = self.client.delete(
            f'{self.notifications_url}/{first.id}',
            **self._auth(access),
        )
        deleted_all = self.client.delete(
            self.notifications_url,
            **self._auth(access),
        )

        self.assertEqual(marked.status_code, status.HTTP_200_OK)
        self.assertEqual(marked.data['updated'], 3)
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(deleted_all.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(Notification.objects.count(), 3)
        self.assertFalse(
            Notification.objects.filter(is_deleted=False).exists(),
        )
        first.refresh_from_db()
        second.refresh_from_db()
        third.refresh_from_db()
        self.assertTrue(first.is_deleted)
        self.assertTrue(second.is_deleted)
        self.assertTrue(third.is_deleted)

    def test_create_notification_aggregates_same_entity_within_minute(self):
        now = timezone.now()

        first = create_notification(
            user=self.user,
            type=NotificationType.AI_TASK_CREATED,
            title='AI создал задачу',
            content='Первый текст',
            entity_type='task',
            entity_id='task-1',
            now=now,
        )
        second = create_notification(
            user=self.user,
            type=NotificationType.AI_TASK_CREATED,
            title='AI обновил задачу',
            content='Второй текст',
            entity_type='task',
            entity_id='task-1',
            now=now + timedelta(seconds=5),
        )
        third = create_notification(
            user=self.user,
            type=NotificationType.AI_TASK_CREATED,
            title='AI создал другую задачу',
            content='Третий текст',
            entity_type='task',
            entity_id='task-2',
            now=now + timedelta(seconds=5),
        )

        self.assertEqual(first.id, second.id)
        self.assertNotEqual(second.id, third.id)
        self.assertEqual(Notification.objects.count(), 2)
        second.refresh_from_db()
        self.assertEqual(second.title, 'AI обновил задачу')
        self.assertEqual(second.content, 'Второй текст')
