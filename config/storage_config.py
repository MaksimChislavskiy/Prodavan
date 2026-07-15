from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured

from config.env import env, env_bool, env_int


FILESYSTEM_BACKENDS = {'filesystem', 'local'}
S3_BACKENDS = {'s3', 's3-compatible'}
S3_ADDRESSING_STYLES = {'path', 'virtual'}


def _required(name):
    value = env(name, '').strip()
    if not value:
        raise ImproperlyConfigured(
            f'{name} обязателен для S3-хранилища.',
        )
    return value


def _s3_storage(*, debug):
    bucket_name = _required('S3_BUCKET_NAME')
    region_name = _required('S3_REGION_NAME')
    endpoint_url = env('S3_ENDPOINT_URL', '').strip()
    if endpoint_url:
        scheme = urlsplit(endpoint_url).scheme.lower()
        if scheme not in {'http', 'https'}:
            raise ImproperlyConfigured(
                'S3_ENDPOINT_URL должен использовать http:// или https://.',
            )
        if not debug and scheme != 'https':
            raise ImproperlyConfigured(
                'S3_ENDPOINT_URL в production должен использовать HTTPS.',
            )

    access_key = env('S3_ACCESS_KEY_ID', '')
    secret_key = env('S3_SECRET_ACCESS_KEY', '')
    if bool(access_key) != bool(secret_key):
        raise ImproperlyConfigured(
            'S3_ACCESS_KEY_ID и S3_SECRET_ACCESS_KEY должны быть заданы вместе.',
        )

    addressing_style = env('S3_ADDRESSING_STYLE', '').strip().lower()
    if addressing_style and addressing_style not in S3_ADDRESSING_STYLES:
        raise ImproperlyConfigured(
            'S3_ADDRESSING_STYLE должен быть path или virtual.',
        )

    verify_tls = env_bool('S3_VERIFY_TLS', True)
    if not debug and not verify_tls:
        raise ImproperlyConfigured(
            'Проверку TLS для S3 нельзя отключать в production.',
        )

    options = {
        'bucket_name': bucket_name,
        'region_name': region_name,
        'default_acl': None,
        'querystring_auth': True,
        'querystring_expire': max(
            60,
            env_int('S3_QUERYSTRING_EXPIRE', 3_600),
        ),
        'file_overwrite': False,
        'location': env('S3_LOCATION', 'media').strip('/'),
        'max_memory_size': max(0, env_int('S3_MAX_MEMORY_SIZE', 5_242_880)),
        'signature_version': 's3v4',
        'verify': verify_tls,
    }
    if endpoint_url:
        options['endpoint_url'] = endpoint_url
    if access_key and secret_key:
        options['access_key'] = access_key
        options['secret_key'] = secret_key
    security_token = env('S3_SECURITY_TOKEN', '')
    if security_token:
        options['security_token'] = security_token
    if addressing_style:
        options['addressing_style'] = addressing_style
    encryption = env('S3_SERVER_SIDE_ENCRYPTION', 'AES256').strip()
    if encryption:
        options['object_parameters'] = {
            'ServerSideEncryption': encryption,
        }

    return {
        'default': {
            'BACKEND': 'storages.backends.s3.S3Storage',
            'OPTIONS': options,
        },
        'staticfiles': {
            'BACKEND': (
                'django.contrib.staticfiles.storage.StaticFilesStorage'
            ),
        },
    }


def build_storage_config(base_dir, *, debug):
    backend = env(
        'MEDIA_STORAGE_BACKEND',
        'filesystem' if debug else 's3',
    ).strip().lower()
    media_root_value = env('MEDIA_ROOT', '').strip()
    media_root = (
        Path(media_root_value)
        if media_root_value
        else Path(base_dir) / 'media'
    )

    if backend in FILESYSTEM_BACKENDS:
        if not debug and not env_bool(
            'ALLOW_LOCAL_MEDIA_IN_PRODUCTION',
            False,
        ):
            raise ImproperlyConfigured(
                'Локальное MEDIA-хранилище запрещено в production. '
                'Настройте S3 либо явно разрешите persistent volume.',
            )
        storages = {
            'default': {
                'BACKEND': 'django.core.files.storage.FileSystemStorage',
            },
            'staticfiles': {
                'BACKEND': (
                    'django.contrib.staticfiles.storage.StaticFilesStorage'
                ),
            },
        }
    elif backend in S3_BACKENDS:
        storages = _s3_storage(debug=debug)
    else:
        raise ImproperlyConfigured(
            'MEDIA_STORAGE_BACKEND должен быть filesystem или s3.',
        )

    return {
        'backend': backend,
        'media_root': media_root,
        'storages': storages,
    }
