from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, override_settings

from config.asgi import application
from users.models import User
from users.services import issue_token_pair


TEST_CHANNEL_LAYERS = {
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
}


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    ALLOWED_HOSTS=['localhost'],
)
class ChatWebSocketContractTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='chat-ws-contract@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.access_token = issue_token_pair(self.user)[0]

    def test_payload_larger_than_64_kb_is_rejected(self):
        async_to_sync(self._oversized_payload_scenario)()

    async def _oversized_payload_scenario(self):
        communicator = WebsocketCommunicator(
            application,
            '/ws/chat',
            headers=[
                (b'host', b'localhost'),
                (b'origin', b'http://localhost'),
            ],
            subprotocols=['Bearer', self.access_token],
        )
        connected, subprotocol = await communicator.connect()
        self.assertTrue(connected)
        self.assertEqual(subprotocol, 'Bearer')

        await communicator.send_json_to({'text': 'x' * (64 * 1024)})
        response = await communicator.receive_json_from()

        self.assertEqual(response['event'], 'error')
        self.assertEqual(response['code'], 'payload_too_large')
        await communicator.disconnect()
