import uuid

from django.core import signing
from django.utils.dateparse import parse_datetime


CURSOR_SALT = 'prodavan.ai-chat.cursor.v1'


class InvalidCursor(ValueError):
    pass


def encode_cursor(*, kind, timestamp, object_id):
    return signing.dumps(
        {
            'kind': kind,
            'timestamp': timestamp.isoformat(),
            'id': str(object_id),
        },
        salt=CURSOR_SALT,
        compress=True,
    )


def decode_cursor(value, *, kind):
    try:
        payload = signing.loads(value, salt=CURSOR_SALT)
        if payload.get('kind') != kind:
            raise InvalidCursor
        timestamp = parse_datetime(payload['timestamp'])
        object_id = uuid.UUID(payload['id'])
        if timestamp is None:
            raise InvalidCursor
    except (KeyError, TypeError, ValueError, signing.BadSignature) as error:
        raise InvalidCursor from error
    return timestamp, object_id
