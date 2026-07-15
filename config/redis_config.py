from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured

from config.env import env, env_int


REDIS_SCHEMES = {'redis', 'rediss'}


def _validate_redis_url(url):
    if url and urlsplit(url).scheme.lower() not in REDIS_SCHEMES:
        raise ImproperlyConfigured(
            'Redis URL должен использовать схему redis:// или rediss://.',
        )


def build_redis_config(*, debug):
    shared_url = env('REDIS_URL', '').strip()
    explicit_channel_url = env('CHANNEL_REDIS_URL', '').strip()
    explicit_cache_url = env('CACHE_REDIS_URL', '').strip()
    channel_url = explicit_channel_url or shared_url or explicit_cache_url
    cache_url = explicit_cache_url or shared_url or channel_url

    _validate_redis_url(channel_url)
    _validate_redis_url(cache_url)

    if not debug and (not channel_url or not cache_url):
        raise ImproperlyConfigured(
            'Для production обязателен REDIS_URL либо отдельные '
            'CHANNEL_REDIS_URL и CACHE_REDIS_URL.',
        )

    socket_timeout = max(1, env_int('REDIS_SOCKET_TIMEOUT', 5))
    if channel_url:
        channel_layers = {
            'default': {
                'BACKEND': 'channels_redis.core.RedisChannelLayer',
                'CONFIG': {
                    'hosts': [channel_url],
                    'capacity': max(1, env_int('CHANNEL_CAPACITY', 1_000)),
                    'expiry': max(1, env_int('CHANNEL_EXPIRY', 60)),
                },
            },
        }
    else:
        channel_layers = {
            'default': {
                'BACKEND': 'channels.layers.InMemoryChannelLayer',
            },
        }

    if cache_url:
        caches = {
            'default': {
                'BACKEND': 'django.core.cache.backends.redis.RedisCache',
                'LOCATION': cache_url,
                'KEY_PREFIX': env('CACHE_KEY_PREFIX', 'prodavan'),
                'OPTIONS': {
                    'socket_connect_timeout': socket_timeout,
                    'socket_timeout': socket_timeout,
                },
            },
        }
    else:
        caches = {
            'default': {
                'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
                'LOCATION': 'prodavan-local',
            },
        }

    return {
        'channel_url': channel_url,
        'cache_url': cache_url,
        'channel_layers': channel_layers,
        'caches': caches,
    }
