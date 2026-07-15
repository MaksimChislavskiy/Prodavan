import os
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from config.redis_config import build_redis_config


class RedisConfigurationTests(SimpleTestCase):
    def test_debug_profile_uses_process_local_backends_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            config = build_redis_config(debug=True)

        self.assertEqual(
            config['channel_layers']['default']['BACKEND'],
            'channels.layers.InMemoryChannelLayer',
        )
        self.assertEqual(
            config['caches']['default']['BACKEND'],
            'django.core.cache.backends.locmem.LocMemCache',
        )

    def test_shared_redis_url_configures_channels_and_cache(self):
        environment = {
            'REDIS_URL': 'rediss://redis.internal:6380/1',
            'REDIS_SOCKET_TIMEOUT': '7',
            'CHANNEL_CAPACITY': '1500',
            'CHANNEL_EXPIRY': '90',
            'CACHE_KEY_PREFIX': 'crm',
        }
        with patch.dict(os.environ, environment, clear=True):
            config = build_redis_config(debug=False)

        channel = config['channel_layers']['default']
        cache = config['caches']['default']
        self.assertEqual(
            channel['BACKEND'],
            'channels_redis.core.RedisChannelLayer',
        )
        self.assertEqual(
            channel['CONFIG']['hosts'],
            ['rediss://redis.internal:6380/1'],
        )
        self.assertEqual(channel['CONFIG']['capacity'], 1500)
        self.assertEqual(channel['CONFIG']['expiry'], 90)
        self.assertEqual(
            cache['BACKEND'],
            'django.core.cache.backends.redis.RedisCache',
        )
        self.assertEqual(cache['LOCATION'], 'rediss://redis.internal:6380/1')
        self.assertEqual(cache['KEY_PREFIX'], 'crm')
        self.assertEqual(cache['OPTIONS']['socket_timeout'], 7)

    def test_legacy_channel_url_is_reused_for_cache(self):
        environment = {'CHANNEL_REDIS_URL': 'redis://localhost:6379/0'}
        with patch.dict(os.environ, environment, clear=True):
            config = build_redis_config(debug=False)

        self.assertEqual(config['channel_url'], environment['CHANNEL_REDIS_URL'])
        self.assertEqual(config['cache_url'], environment['CHANNEL_REDIS_URL'])

    def test_production_without_redis_fails_fast(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'Для production обязателен REDIS_URL',
            ):
                build_redis_config(debug=False)

    def test_unsupported_redis_scheme_is_rejected_without_echoing_url(self):
        with patch.dict(
            os.environ,
            {'REDIS_URL': 'http://user:secret@redis.internal/cache'},
            clear=True,
        ):
            with self.assertRaises(ImproperlyConfigured) as error:
                build_redis_config(debug=False)

        self.assertNotIn('secret', str(error.exception))
