import json

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .realtime import workspace_group_name


class ChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if user is None or not user.is_authenticated:
            await self.close(code=1008)
            return
        self.group_name = workspace_group_name(user.workspace_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
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

    async def chat_event(self, event):
        await self.send_json(event['payload'])
