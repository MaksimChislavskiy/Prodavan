from django.core import signing
from django.utils.dateparse import parse_datetime


CURSOR_SALT = 'prodavan.tasks.cursor.v1'


def encode_task_cursor(task):
    return signing.dumps(
        {
            'due_date': task.due_date.isoformat() if task.due_date else None,
            'created_at': task.created_at.isoformat(),
            'id': str(task.id),
        },
        salt=CURSOR_SALT,
        compress=True,
    )


def decode_task_cursor(value):
    try:
        payload = signing.loads(value, salt=CURSOR_SALT, max_age=86_400)
        due_date = parse_datetime(payload['due_date']) if payload['due_date'] else None
        created_at = parse_datetime(payload['created_at'])
        object_id = payload['id']
        if created_at is None:
            raise ValueError
        return due_date, created_at, object_id
    except (KeyError, TypeError, ValueError, signing.BadSignature) as error:
        raise ValueError('Некорректный курсор.') from error


def encode_history_cursor(entry):
    return signing.dumps(
        {'created_at': entry.created_at.isoformat(), 'id': str(entry.id)},
        salt=f'{CURSOR_SALT}.history',
        compress=True,
    )


def decode_history_cursor(value):
    try:
        payload = signing.loads(
            value,
            salt=f'{CURSOR_SALT}.history',
            max_age=86_400,
        )
        created_at = parse_datetime(payload['created_at'])
        if created_at is None:
            raise ValueError
        return created_at, payload['id']
    except (KeyError, TypeError, ValueError, signing.BadSignature) as error:
        raise ValueError('Некорректный курсор.') from error
