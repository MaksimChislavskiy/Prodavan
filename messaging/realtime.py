import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


logger = logging.getLogger(__name__)


def workspace_group_name(workspace_id):
    return f'workspace_chat_{workspace_id.hex}'


def broadcast_workspace_event(workspace_id, payload):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    try:
        async_to_sync(channel_layer.group_send)(
            workspace_group_name(workspace_id),
            {'type': 'chat.event', 'payload': payload},
        )
    except Exception:
        logger.exception(
            'Не удалось отправить WebSocket-событие workspace=%s event=%s',
            workspace_id,
            payload.get('event'),
        )
