from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def workspace_group_name(workspace_id):
    return f'workspace_chat_{workspace_id.hex}'


def user_group_name(user_id):
    return f'user_notifications_{user_id.hex}'


def broadcast_workspace_event(workspace_id, payload):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        workspace_group_name(workspace_id),
        {'type': 'chat.event', 'payload': payload},
    )


def broadcast_user_event(user_id, payload):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        user_group_name(user_id),
        {'type': 'chat.event', 'payload': payload},
    )
