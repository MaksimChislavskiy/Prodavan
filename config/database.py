from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

from config.env import env, env_int


POSTGRESQL_ENGINES = {
    'postgres',
    'postgresql',
    'django.db.backends.postgresql',
}
SQLITE_ENGINES = {'sqlite', 'sqlite3', 'django.db.backends.sqlite3'}
POSTGRESQL_SSL_MODES = {
    'disable',
    'allow',
    'prefer',
    'require',
    'verify-ca',
    'verify-full',
}


def _required(name):
    value = env(name, '')
    if not value:
        raise ImproperlyConfigured(
            f'{name} обязателен при использовании PostgreSQL.',
        )
    return value


def _postgresql_config():
    ssl_mode = env('DATABASE_SSLMODE', 'require').strip().lower()
    if ssl_mode not in POSTGRESQL_SSL_MODES:
        allowed = ', '.join(sorted(POSTGRESQL_SSL_MODES))
        raise ImproperlyConfigured(
            f'DATABASE_SSLMODE должен быть одним из: {allowed}.',
        )

    port = env_int('DATABASE_PORT', 5432)
    if not 1 <= port <= 65_535:
        raise ImproperlyConfigured(
            'DATABASE_PORT должен быть в диапазоне 1–65535.',
        )

    connect_timeout = env_int('DATABASE_CONNECT_TIMEOUT', 10)
    if connect_timeout < 1:
        raise ImproperlyConfigured(
            'DATABASE_CONNECT_TIMEOUT должен быть не меньше 1 секунды.',
        )

    return {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': _required('DATABASE_NAME'),
        'USER': _required('DATABASE_USER'),
        'PASSWORD': _required('DATABASE_PASSWORD'),
        'HOST': _required('DATABASE_HOST'),
        'PORT': port,
        'CONN_MAX_AGE': max(0, env_int('DATABASE_CONN_MAX_AGE', 60)),
        'CONN_HEALTH_CHECKS': True,
        'OPTIONS': {
            'sslmode': ssl_mode,
            'connect_timeout': connect_timeout,
            'application_name': env('DATABASE_APPLICATION_NAME', 'prodavan'),
        },
    }


def build_database_config(base_dir):
    engine = env('DATABASE_ENGINE', 'sqlite').strip().lower()
    if engine in SQLITE_ENGINES:
        database_name = env('DATABASE_NAME', '').strip()
        return {
            'default': {
                'ENGINE': 'django.db.backends.sqlite3',
                'NAME': database_name or str(Path(base_dir) / 'db.sqlite3'),
            },
        }
    if engine in POSTGRESQL_ENGINES:
        return {'default': _postgresql_config()}

    raise ImproperlyConfigured(
        'DATABASE_ENGINE должен быть sqlite или postgresql.',
    )
