import uuid

from django.core import signing
from django.utils.dateparse import parse_datetime


CURSOR_SALT = 'prodavan.notifications.cursor.v1'


class InvalidCursor(ValueError):
    pass


def encode_notification_cursor(notification):
    return signing.dumps(
        {
            'created_at': notification.created_at.isoformat(),
            'id': str(notification.id),
        },
        salt=CURSOR_SALT,
        compress=True,
    )


def decode_notification_cursor(value):
    try:
        payload = signing.loads(value, salt=CURSOR_SALT)
        created_at = parse_datetime(payload['created_at'])
        notification_id = uuid.UUID(payload['id'])
        if created_at is None:
            raise InvalidCursor
    except (KeyError, TypeError, ValueError, signing.BadSignature) as error:
        raise InvalidCursor from error
    return created_at, notification_id
