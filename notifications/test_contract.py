import uuid

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import Notification, NotificationType


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class NotificationContractTests(TestCase):
    notifications_url = '/api/notifications'

    def setUp(self):
        self.user = User.objects.create_user(
            email='notifications-contract@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.other = User.objects.create_user(
            email='notifications-contract-other@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _notification(self, *, notification_id=None, user=None, **overrides):
        target_user = user or self.user
        defaults = {
            'workspace': target_user.workspace,
            'user': target_user,
            'type': NotificationType.AI_TASK_CREATED,
            'title': 'AI создал задачу',
            'content': 'Задача создана по переписке.',
            'link': '/tasks/123',
            'entity_type': 'task',
            'entity_id': '123',
        }
        if notification_id is not None:
            defaults['id'] = notification_id
        defaults.update(overrides)
        return Notification.objects.create(**defaults)

    def test_invalid_cursor_returns_400_invalid_cursor(self):
        response = self.client.get(
            self.notifications_url,
            {'limit': 50, 'cursor': 'definitely-not-an-opaque-cursor'},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error']['code'], 'INVALID_CURSOR')
        self.assertEqual(response.data['error']['message'], 'Некорректный cursor.')

    def test_same_created_at_is_stable_by_id_desc_across_cursor_pages(self):
        created_at = timezone.now().replace(microsecond=0)
        ids = [
            uuid.UUID('00000000-0000-0000-0000-000000000001'),
            uuid.UUID('00000000-0000-0000-0000-000000000002'),
            uuid.UUID('00000000-0000-0000-0000-000000000003'),
            uuid.UUID('00000000-0000-0000-0000-000000000004'),
        ]
        for notification_id in ids:
            notification = self._notification(
                notification_id=notification_id,
                title=f'Уведомление {notification_id.int}',
            )
            Notification.objects.filter(id=notification.id).update(
                created_at=created_at,
            )

        first = self.client.get(self.notifications_url, {'limit': 2})
        second = self.client.get(
            self.notifications_url,
            {'limit': 2, 'cursor': first.data['next_cursor']},
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [item['id'] for item in first.data['notifications']],
            [str(ids[3]), str(ids[2])],
        )
        self.assertEqual(
            [item['id'] for item in second.data['notifications']],
            [str(ids[1]), str(ids[0])],
        )
        self.assertEqual(
            len({
                item['id']
                for response in (first, second)
                for item in response.data['notifications']
            }),
            4,
        )
        self.assertTrue(first.data['has_more'])
        self.assertFalse(second.data['has_more'])

    def test_foreign_notification_is_404_for_read_and_delete(self):
        foreign = self._notification(user=self.other)

        read = self.client.patch(
            f'{self.notifications_url}/{foreign.id}/read',
        )
        deleted = self.client.delete(
            f'{self.notifications_url}/{foreign.id}',
        )

        self.assertEqual(read.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(deleted.status_code, status.HTTP_404_NOT_FOUND)
        foreign.refresh_from_db()
        self.assertFalse(foreign.is_read)
        self.assertFalse(foreign.is_deleted)

    def test_soft_deleted_notification_is_hidden_and_returns_404(self):
        notification = self._notification()
        notification.is_deleted = True
        notification.deleted_at = timezone.now()
        notification.save(update_fields=('is_deleted', 'deleted_at', 'updated_at'))

        listed = self.client.get(self.notifications_url, {'limit': 50})
        read = self.client.patch(
            f'{self.notifications_url}/{notification.id}/read',
        )
        deleted = self.client.delete(
            f'{self.notifications_url}/{notification.id}',
        )

        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual(listed.data['notifications'], [])
        self.assertEqual(read.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(deleted.status_code, status.HTTP_404_NOT_FOUND)
