from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.db import close_old_connections, connection
from django.test import (
    TransactionTestCase,
    override_settings,
    skipUnlessDBFeature,
)

from users.models import User

from .models import Notification, NotificationType
from .services import create_notification


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class NotificationAggregationConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.user = User.objects.create_user(
            email='notification-race@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

    def _create(self, barrier, content):
        close_old_connections()
        try:
            user = User.objects.get(id=self.user.id)
            barrier.wait(timeout=5)
            notification = create_notification(
                user=user,
                type=NotificationType.AI_TASK_CREATED,
                title='AI создал задачу',
                content=content,
                entity_type='task',
                entity_id='same-task',
            )
            return str(notification.id)
        finally:
            connection.close()

    # This test verifies the row-locking strategy used in production PostgreSQL.
    # SQLite does not support SELECT ... FOR UPDATE and can only report table locks
    # for this threaded scenario, so running the test there would be a false failure.
    @skipUnlessDBFeature('has_select_for_update')
    @patch('notifications.services.broadcast_user_event')
    def test_concurrent_same_object_events_are_aggregated(self, broadcast):
        barrier = Barrier(2)

        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(self._create, barrier, 'Первое изменение')
            second = executor.submit(self._create, barrier, 'Второе изменение')
            ids = [first.result(timeout=10), second.result(timeout=10)]

        self.assertEqual(ids[0], ids[1])
        self.assertEqual(Notification.objects.count(), 1)
        notification = Notification.objects.get()
        self.assertFalse(notification.is_read)
        self.assertEqual(notification.entity_type, 'task')
        self.assertEqual(notification.entity_id, 'same-task')
        self.assertIn(
            notification.content,
            {'Первое изменение', 'Второе изменение'},
        )
