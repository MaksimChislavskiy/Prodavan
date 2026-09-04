import json

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .realtime import user_session_group_name, workspace_group_name


class ReadOnlyEventConsumer(AsyncJsonWebsocketConsumer):
    def group_name_for_user(self, user):
        raise NotImplementedError

    async def connect(self):
        user = self.scope.get('user')
        if user is None or not user.is_authenticated:
            await self.close(code=1008)
            return
        self.group_name = self.group_name_for_user(user)
        self.session_group_name = user_session_group_name(user.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.channel_layer.group_add(
            self.session_group_name,
            self.channel_name,
        )
        await self.accept(
            subprotocol=self.scope.get('accepted_subprotocol'),
        )

    async def disconnect(self, close_code):
        group_name = getattr(self, 'group_name', None)
        if group_name:
            await self.channel_layer.group_discard(
                group_name,
                self.channel_name,
            )
        session_group_name = getattr(self, 'session_group_name', None)
        if session_group_name:
            await self.channel_layer.group_discard(
                session_group_name,
                self.channel_name,
            )

    async def receive_json(self, content, **kwargs):
        if len(json.dumps(content, ensure_ascii=False).encode('utf-8')) > 64 * 1024:
            await self.send_json(
                {
                    'event': 'error',
                    'code': 'payload_too_large',
                    'message': 'WebSocket payload exceeds 64 KB.',
                },
            )
            return
        await self.send_json(
            {
                'event': 'error',
                'code': 'unsupported_action',
                'message': 'Отправляйте сообщения через HTTP API.',
            },
        )

    async def send_event_payload(self, event):
        await self.send_json(event['payload'])

    async def force_disconnect(self, event):
        await self.close(code=event.get('code', 4001))


class ChatConsumer(ReadOnlyEventConsumer):
    def group_name_for_user(self, user):
        return workspace_group_name(user.workspace_id)

    async def chat_event(self, event):
        await self.send_event_payload(event)
