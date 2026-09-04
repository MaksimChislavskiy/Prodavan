from django.core import signing


ATTACHMENT_TOKEN_SALT = 'messaging.telegram-attachment'
ATTACHMENT_TOKEN_MAX_AGE = 24 * 60 * 60


def create_attachment_token(message):
    return signing.dumps(
        {
            'message_id': str(message.id),
            'workspace_id': str(message.chat.workspace_id),
        },
        salt=ATTACHMENT_TOKEN_SALT,
        compress=True,
    )


def read_attachment_token(token):
    try:
        payload = signing.loads(
            token,
            salt=ATTACHMENT_TOKEN_SALT,
            max_age=ATTACHMENT_TOKEN_MAX_AGE,
        )
    except (signing.BadSignature, signing.SignatureExpired):
        return None

    if not isinstance(payload, dict):
        return None
    message_id = payload.get('message_id')
    workspace_id = payload.get('workspace_id')
    if not isinstance(message_id, str) or not isinstance(workspace_id, str):
        return None
    return message_id, workspace_id
