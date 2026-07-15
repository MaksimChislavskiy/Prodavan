import os
from pathlib import Path
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from config.database import build_database_config


class DatabaseConfigurationTests(SimpleTestCase):
    def test_sqlite_is_the_local_default(self):
        with patch.dict(
            os.environ,
            {'DATABASE_ENGINE': 'sqlite', 'DATABASE_NAME': ''},
            clear=True,
        ):
            config = build_database_config(Path('project'))['default']

        self.assertEqual(config['ENGINE'], 'django.db.backends.sqlite3')
        self.assertEqual(config['NAME'], str(Path('project') / 'db.sqlite3'))

    def test_postgresql_configuration_uses_secure_operational_defaults(self):
        environment = {
            'DATABASE_ENGINE': 'postgresql',
            'DATABASE_NAME': 'prodavan',
            'DATABASE_USER': 'prodavan_app',
            'DATABASE_PASSWORD': 'secret',
            'DATABASE_HOST': 'postgres.internal',
        }
        with patch.dict(os.environ, environment, clear=True):
            config = build_database_config(Path('project'))['default']

        self.assertEqual(config['ENGINE'], 'django.db.backends.postgresql')
        self.assertEqual(config['PORT'], 5432)
        self.assertEqual(config['CONN_MAX_AGE'], 60)
        self.assertTrue(config['CONN_HEALTH_CHECKS'])
        self.assertEqual(config['OPTIONS']['sslmode'], 'require')
        self.assertEqual(config['OPTIONS']['connect_timeout'], 10)
        self.assertEqual(config['OPTIONS']['application_name'], 'prodavan')

    def test_postgresql_requires_connection_credentials(self):
        environment = {
            'DATABASE_ENGINE': 'postgresql',
            'DATABASE_USER': 'prodavan_app',
            'DATABASE_PASSWORD': 'secret',
            'DATABASE_HOST': 'postgres.internal',
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'DATABASE_NAME обязателен',
            ):
                build_database_config(Path('project'))

    def test_postgresql_rejects_unsupported_ssl_mode(self):
        environment = {
            'DATABASE_ENGINE': 'postgresql',
            'DATABASE_NAME': 'prodavan',
            'DATABASE_USER': 'prodavan_app',
            'DATABASE_PASSWORD': 'secret',
            'DATABASE_HOST': 'postgres.internal',
            'DATABASE_SSLMODE': 'unsafe',
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'DATABASE_SSLMODE',
            ):
                build_database_config(Path('project'))

    def test_unknown_database_engine_is_rejected(self):
        with patch.dict(
            os.environ,
            {'DATABASE_ENGINE': 'unknown'},
            clear=True,
        ):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'DATABASE_ENGINE',
            ):
                build_database_config(Path('project'))
