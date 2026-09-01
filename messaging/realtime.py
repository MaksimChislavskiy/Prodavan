import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


logger = logging.getLogger(__name__)


def workspace_group_name(workspace_id):
    return f'workspace_chat_{workspace_id.hex}'


def user_group_name(user_id):
    return f'user_notifications_{user_id.hex}'


def user_session_group_name(user_id):
    return f'user_sessions_{user_id.hex}'


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
            payload.get('event') if isinstance(payload, dict) else None,
        )


def broadcast_user_event(user_id, payload):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            user_group_name(user_id),
            {'type': 'notification.event', 'payload': payload},
        )
    except Exception:
        logger.exception(
            'Не удалось отправить WebSocket-событие user=%s event=%s',
            user_id,
            payload.get('event') if isinstance(payload, dict) else None,
        )


def disconnect_user_sessions(user_id):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            user_session_group_name(user_id),
            {'type': 'force.disconnect', 'code': 4001},
        )
    except Exception:
        logger.exception(
            'Не удалось завершить WebSocket-сессии user=%s',
            user_id,
        )
