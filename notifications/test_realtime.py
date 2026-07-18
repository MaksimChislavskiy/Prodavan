from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, override_settings

from config.asgi import application
from messaging.realtime import user_group_name, workspace_group_name
from users.models import User
from users.services import issue_token_pair

from .models import NotificationType
from .services import create_notification


TEST_CHANNEL_LAYERS = {
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
}


@database_sync_to_async
def _create_notification(user_id):
    user = User.objects.get(id=user_id)
    return create_notification(
        user=user,
        type=NotificationType.AI_TASK_CREATED,
        title='AI создал задачу',
        content='Задача создана по результатам переписки.',
        link='/tasks/task-id',
        entity_type='task',
        entity_id='task-id',
    )


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    ALLOWED_HOSTS=['localhost'],
)
class RealtimeNotificationTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='notifications@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.other = User.objects.create_user(
            email='other@example.com',
            password='StrongPass1',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        self.access_token = issue_token_pair(self.user)[0]

    @staticmethod
    def _headers():
        return [
            (b'host', b'localhost'),
            (b'origin', b'http://localhost'),
        ]

    def test_bearer_subprotocol_receives_service_events_without_echoing_token(self):
        async_to_sync(self._service_event_scenario)()

    async def _service_event_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            '/ws/notifications',
            headers=self._headers(),
            subprotocols=['Bearer', self.access_token],
        )
        connected, subprotocol = await communicator.connect()
        self.assertTrue(connected)
        self.assertEqual(subprotocol, 'Bearer')

        notification = await _create_notification(self.user.id)

        created = await communicator.receive_json_from()
        unread = await communicator.receive_json_from()
        self.assertEqual(created['event'], 'notification_created')
        self.assertEqual(created['payload']['id'], str(notification.id))
        self.assertEqual(unread['event'], 'unread_count_updated')
        self.assertEqual(unread['payload']['unread_count'], 1)
        await communicator.disconnect()

    def test_notification_socket_isolated_from_workspace_and_other_users(self):
        async_to_sync(self._isolation_scenario)()

    async def _isolation_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            '/ws/notifications',
            headers=self._headers(),
            subprotocols=['Bearer', self.access_token],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        payload = {'event': 'notification_created', 'payload': {'id': 'other'}}
        await get_channel_layer().group_send(
            user_group_name(self.other.id),
            {'type': 'notification.event', 'payload': payload},
        )
        await get_channel_layer().group_send(
            workspace_group_name(self.user.workspace_id),
            {'type': 'chat.event', 'payload': {'event': 'message_created'}},
        )
        self.assertTrue(await communicator.receive_nothing(timeout=0.05))
        await communicator.disconnect()

    def test_invalid_token_is_closed_with_policy_violation(self):
        async_to_sync(self._invalid_token_scenario)()

    async def _invalid_token_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            '/ws/notifications',
            headers=self._headers(),
            subprotocols=['Bearer', 'invalid'],
        )
        connected, close_code = await communicator.connect()
        self.assertFalse(connected)
        self.assertEqual(close_code, 1008)

    def test_revoked_token_version_cannot_connect(self):
        self.user.token_version += 1
        self.user.save(update_fields=('token_version', 'updated_at'))
        async_to_sync(self._revoked_token_scenario)()

    async def _revoked_token_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            '/ws/notifications',
            headers=self._headers(),
            subprotocols=['Bearer', self.access_token],
        )
        connected, close_code = await communicator.connect()
        self.assertFalse(connected)
        self.assertEqual(close_code, 1008)

    def test_client_commands_are_rejected_in_favor_of_rest_api(self):
        async_to_sync(self._unsupported_action_scenario)()

    async def _unsupported_action_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            '/ws/notifications',
            headers=self._headers(),
            subprotocols=['Bearer', self.access_token],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        await communicator.send_json_to({'action': 'mark_all_read'})
        response = await communicator.receive_json_from()
        self.assertEqual(response['event'], 'error')
        self.assertEqual(response['code'], 'unsupported_action')
        await communicator.disconnect()
