from django.core import signing
from django.utils.dateparse import parse_datetime


CURSOR_SALT = 'prodavan.crm.cursor.v1'


def encode_cursor(*, timestamp, object_id):
    return signing.dumps(
        {'timestamp': timestamp.isoformat(), 'id': str(object_id)},
        salt=CURSOR_SALT,
        compress=True,
    )


def decode_cursor(value):
    try:
        payload = signing.loads(value, salt=CURSOR_SALT, max_age=86_400)
        timestamp = parse_datetime(payload['timestamp'])
        object_id = payload['id']
        if timestamp is None:
            raise ValueError
        return timestamp, object_id
    except (KeyError, TypeError, ValueError, signing.BadSignature) as error:
        raise ValueError('Некорректный курсор.') from error
