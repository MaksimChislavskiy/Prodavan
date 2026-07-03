import base64
import binascii
import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured


_MISSING = object()


def load_env_file(path):
    path = Path(path)
    if not path.exists():
        return

    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].lstrip()
        key, separator, value = line.partition('=')
        if not separator:
            continue
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        os.environ.setdefault(key, value)


def env(name, default=_MISSING):
    value = os.environ.get(name)
    if value is not None:
        return value
    if default is not _MISSING:
        return default
    raise ImproperlyConfigured(
        f'Обязательная переменная окружения {name} не задана. '
        'Скопируйте .env.example в .env и заполните значение.',
    )


def env_bool(name, default=False):
    value = env(name, str(default)).strip().lower()
    if value in {'1', 'true', 'yes', 'on'}:
        return True
    if value in {'0', 'false', 'no', 'off'}:
        return False
    raise ImproperlyConfigured(
        f'{name} должен содержать true/false, 1/0, yes/no или on/off.',
    )


def env_int(name, default):
    value = env(name, str(default))
    try:
        return int(value)
    except ValueError as error:
        raise ImproperlyConfigured(f'{name} должен быть целым числом.') from error


def env_float(name, default):
    value = env(name, str(default))
    try:
        return float(value)
    except ValueError as error:
        raise ImproperlyConfigured(f'{name} должен быть числом.') from error


def env_list(name, default=()):
    value = env(name, ','.join(default))
    return [item.strip() for item in value.split(',') if item.strip()]


def env_secret(name, min_length=32):
    value = env(name)
    if len(value) < min_length:
        raise ImproperlyConfigured(
            f'{name} должен содержать минимум {min_length} символов.',
        )
    return value


def env_base64_key(name, expected_bytes=32):
    value = env(name)
    try:
        decoded = base64.urlsafe_b64decode(value.encode('ascii'))
    except (ValueError, UnicodeEncodeError, binascii.Error) as error:
        raise ImproperlyConfigured(
            f'{name} должен быть ключом в URL-safe Base64.',
        ) from error
    if len(decoded) != expected_bytes:
        raise ImproperlyConfigured(
            f'{name} после декодирования должен содержать '
            f'{expected_bytes} байт.',
        )
    return value
