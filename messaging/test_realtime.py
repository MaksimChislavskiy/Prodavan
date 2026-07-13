from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, override_settings

from config.asgi import application
from users.models import User
from users.services import issue_token_pair

from .realtime import user_group_name, workspace_group_name


TEST_CHANNEL_LAYERS = {
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
}


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    ALLOWED_HOSTS=['localhost'],
)
class RealtimeChatTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='socket@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.access_token = issue_token_pair(self.user)[0]

    @staticmethod
    def _headers():
        return [
            (b'host', b'localhost'),
            (b'origin', b'http://localhost'),
        ]

    def test_query_token_connects_and_receives_workspace_event(self):
        async_to_sync(self._query_token_scenario)()

    async def _query_token_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            f'/ws/chat?token={self.access_token}',
            headers=self._headers(),
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        payload = {'event': 'message_read', 'chat_id': 'chat-id'}
        await get_channel_layer().group_send(
            workspace_group_name(self.user.workspace_id),
            {'type': 'chat.event', 'payload': payload},
        )
        self.assertEqual(await communicator.receive_json_from(), payload)
        await communicator.disconnect()

    def test_connected_user_receives_personal_notification_event(self):
        async_to_sync(self._personal_notification_scenario)()

    async def _personal_notification_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            f'/ws/chat?token={self.access_token}',
            headers=self._headers(),
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        payload = {
            'event': 'notification_created',
            'payload': {'id': 'notification-id'},
        }
        await get_channel_layer().group_send(
            user_group_name(self.user.id),
            {'type': 'chat.event', 'payload': payload},
        )
        self.assertEqual(await communicator.receive_json_from(), payload)
        await communicator.disconnect()

    def test_bearer_subprotocol_is_supported_without_echoing_token(self):
        async_to_sync(self._subprotocol_scenario)()

    async def _subprotocol_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            '/ws/chat',
            headers=self._headers(),
            subprotocols=['Bearer', self.access_token],
        )
        connected, subprotocol = await communicator.connect()
        self.assertTrue(connected)
        self.assertEqual(subprotocol, 'Bearer')
        await communicator.disconnect()

    def test_invalid_token_is_closed_with_policy_violation(self):
        async_to_sync(self._invalid_token_scenario)()

    async def _invalid_token_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            '/ws/chat?token=invalid',
            headers=self._headers(),
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
            f'/ws/chat?token={self.access_token}',
            headers=self._headers(),
        )
        connected, close_code = await communicator.connect()
        self.assertFalse(connected)
        self.assertEqual(close_code, 1008)

    def test_client_commands_are_rejected_in_favor_of_http_api(self):
        async_to_sync(self._unsupported_action_scenario)()

    async def _unsupported_action_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            f'/ws/chat?token={self.access_token}',
            headers=self._headers(),
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        await communicator.send_json_to({'text': 'Нельзя отправлять здесь'})
        response = await communicator.receive_json_from()
        self.assertEqual(response['event'], 'error')
        self.assertEqual(response['code'], 'unsupported_action')
        await communicator.disconnect()
