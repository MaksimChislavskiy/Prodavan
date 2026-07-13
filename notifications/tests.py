from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from deals.models import Deal, SalesStage
from tasks.models import DueDateType, Task, TaskStatus
from users.models import User

from .deal_attention import create_deal_attention_notifications
from .models import Notification, NotificationType
from .services import create_notification
from .task_deadlines import create_task_deadline_notifications


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


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class TaskDeadlineNotificationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.workspace = self.user.workspace
        self.workspace.timezone = 'Europe/Moscow'
        self.workspace.save(update_fields=('timezone', 'updated_at'))
        self.teammate = User.objects.create_user(
            email='teammate@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            workspace=self.workspace,
            is_confirmed=True,
        )
        self.inactive = User.objects.create_user(
            email='inactive@example.com',
            password='StrongPass3',
            first_name='Сидор',
            last_name='Сидоров',
            workspace=self.workspace,
            is_confirmed=True,
            is_active=False,
        )
        self.deleted = User.objects.create_user(
            email='deleted@example.com',
            password='StrongPass4',
            first_name='Анна',
            last_name='Петрова',
            workspace=self.workspace,
            is_confirmed=True,
            is_deleted=True,
        )

    def _task(self, **overrides):
        defaults = {
            'workspace': self.workspace,
            'title': 'Позвонить клиенту',
            'due_date': timezone.now(),
            'due_date_type': DueDateType.DATE,
            'status': TaskStatus.NEW,
        }
        defaults.update(overrides)
        return Task.objects.create(**defaults)

    def test_creates_date_due_soon_and_overdue_notifications_once_per_day(self):
        now = timezone.now().replace(hour=12, minute=0, second=0, microsecond=0)
        due_today = self._task(
            title='Позвонить клиенту',
            due_date=now,
            due_date_type=DueDateType.DATE,
        )
        overdue = self._task(
            title='Выставить счёт',
            due_date=now - timedelta(days=2),
            due_date_type=DueDateType.DATE,
        )
        done = self._task(
            title='Уже выполнено',
            due_date=now - timedelta(days=2),
            due_date_type=DueDateType.DATE,
            status=TaskStatus.DONE,
        )

        counters = create_task_deadline_notifications(now=now)
        repeated = create_task_deadline_notifications(now=now + timedelta(minutes=10))

        self.assertEqual(counters['due_soon_tasks'], 1)
        self.assertEqual(counters['overdue_tasks'], 1)
        self.assertEqual(counters['notifications_created'], 4)
        self.assertEqual(repeated['notifications_created'], 0)
        self.assertEqual(
            Notification.objects.filter(
                type=NotificationType.TASK_DUE_SOON,
                entity_id=str(due_today.id),
            ).count(),
            2,
        )
        self.assertEqual(
            Notification.objects.filter(
                type=NotificationType.TASK_OVERDUE,
                entity_id=str(overdue.id),
            ).count(),
            2,
        )
        self.assertFalse(
            Notification.objects.filter(entity_id=str(done.id)).exists(),
        )
        self.assertFalse(
            Notification.objects.filter(user=self.inactive).exists(),
        )
        self.assertFalse(
            Notification.objects.filter(user=self.deleted).exists(),
        )

    def test_datetime_due_soon_uses_one_hour_window(self):
        now = timezone.now()
        due_soon = self._task(
            title='Отправить КП',
            due_date=now + timedelta(minutes=30),
            due_date_type=DueDateType.DATETIME,
        )
        due_later = self._task(
            title='Созвон через два часа',
            due_date=now + timedelta(hours=2),
            due_date_type=DueDateType.DATETIME,
        )
        overdue = self._task(
            title='Ответить клиенту',
            due_date=now - timedelta(minutes=1),
            due_date_type=DueDateType.DATETIME,
        )

        counters = create_task_deadline_notifications(now=now)

        self.assertEqual(counters['due_soon_tasks'], 1)
        self.assertEqual(counters['overdue_tasks'], 1)
        self.assertEqual(counters['notifications_created'], 4)
        self.assertEqual(
            Notification.objects.filter(
                type=NotificationType.TASK_DUE_SOON,
                entity_id=str(due_soon.id),
            ).count(),
            2,
        )
        self.assertFalse(
            Notification.objects.filter(entity_id=str(due_later.id)).exists(),
        )
        self.assertEqual(
            Notification.objects.filter(
                type=NotificationType.TASK_OVERDUE,
                entity_id=str(overdue.id),
            ).count(),
            2,
        )


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class DealAttentionNotificationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='deal-owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.workspace = self.user.workspace
        self.workspace.timezone = 'Europe/Moscow'
        self.workspace.save(update_fields=('timezone', 'updated_at'))
        self.teammate = User.objects.create_user(
            email='deal-teammate@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            workspace=self.workspace,
            is_confirmed=True,
        )
        self.inactive = User.objects.create_user(
            email='deal-inactive@example.com',
            password='StrongPass3',
            first_name='Сидор',
            last_name='Сидоров',
            workspace=self.workspace,
            is_confirmed=True,
            is_active=False,
        )
        self.stage = SalesStage.objects.get(
            workspace=self.workspace,
            is_system=True,
        )
        self.deal = Deal.objects.create(
            workspace=self.workspace,
            stage=self.stage,
            name='Внедрение CRM',
        )

    def _task(self, *, deal=None, **overrides):
        defaults = {
            'workspace': self.workspace,
            'deal': self.deal if deal is None else deal,
            'title': 'Отправить коммерческое предложение',
            'due_date': timezone.now() - timedelta(days=1),
            'due_date_type': DueDateType.DATE,
            'status': TaskStatus.NEW,
        }
        defaults.update(overrides)
        return Task.objects.create(**defaults)

    def test_notifies_once_per_deal_and_local_day(self):
        now = timezone.now().replace(hour=12, minute=0, second=0, microsecond=0)
        self._task(
            title='Отправить КП',
            due_date=now - timedelta(days=2),
        )
        self._task(
            title='Позвонить клиенту',
            due_date=now - timedelta(days=1),
        )
        self._task(
            title='Задача на сегодня',
            due_date=now,
        )
        self._task(
            title='Выполненная задача',
            due_date=now - timedelta(days=3),
            status=TaskStatus.DONE,
        )

        counters = create_deal_attention_notifications(now=now)
        repeated = create_deal_attention_notifications(
            now=now + timedelta(minutes=10),
        )

        self.assertEqual(counters['deals_requiring_attention'], 1)
        self.assertEqual(counters['overdue_tasks'], 2)
        self.assertEqual(counters['notifications_created'], 2)
        self.assertEqual(repeated['notifications_created'], 0)
        notifications = Notification.objects.filter(
            type=NotificationType.DEAL_ATTENTION,
            entity_id=str(self.deal.id),
        )
        self.assertEqual(notifications.count(), 2)
        self.assertEqual(
            {item.user_id for item in notifications},
            {self.user.id, self.teammate.id},
        )
        self.assertFalse(notifications.filter(user=self.inactive).exists())
        notification = notifications.filter(user=self.user).get()
        self.assertEqual(notification.entity_type, 'deal')
        self.assertEqual(notification.link, f'/deals/{self.deal.id}')
        self.assertIn('просрочено задач: 2', notification.content)

    def test_ignores_deleted_deals_and_notifies_again_next_day(self):
        now = timezone.now()
        deleted_deal = Deal.objects.create(
            workspace=self.workspace,
            stage=self.stage,
            name='Удалённая сделка',
            is_deleted=True,
            deleted_at=now,
        )
        self._task(
            deal=deleted_deal,
            due_date=now - timedelta(minutes=5),
            due_date_type=DueDateType.DATETIME,
        )
        self._task(
            due_date=now - timedelta(minutes=5),
            due_date_type=DueDateType.DATETIME,
        )

        first = create_deal_attention_notifications(now=now)
        next_day = create_deal_attention_notifications(
            now=now + timedelta(days=1),
        )

        self.assertEqual(first['deals_requiring_attention'], 1)
        self.assertEqual(first['notifications_created'], 2)
        self.assertEqual(next_day['notifications_created'], 2)
        self.assertEqual(
            Notification.objects.filter(
                type=NotificationType.DEAL_ATTENTION,
                entity_id=str(self.deal.id),
            ).count(),
            4,
        )
        notification = Notification.objects.filter(
            user=self.user,
            type=NotificationType.DEAL_ATTENTION,
        ).first()
        self.assertIn('просрочена задача', notification.content)
        self.assertFalse(
            Notification.objects.filter(entity_id=str(deleted_deal.id)).exists(),
        )
