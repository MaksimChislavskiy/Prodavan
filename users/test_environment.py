import base64
import os
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from config.env import env_base64_key, env_secret, load_env_file


class EnvironmentLoaderTests(SimpleTestCase):
    def test_load_env_file_does_not_override_process_environment(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text('EXISTING=file\nNEW_VALUE=loaded\n', encoding='utf-8')
            with patch.dict(os.environ, {'EXISTING': 'process'}, clear=False):
                os.environ.pop('NEW_VALUE', None)
                load_env_file(path)
                self.assertEqual(os.environ['EXISTING'], 'process')
                self.assertEqual(os.environ['NEW_VALUE'], 'loaded')
                os.environ.pop('NEW_VALUE', None)

    def test_secret_rejects_short_value(self):
        with patch.dict(os.environ, {'SHORT_SECRET': 'too-short'}, clear=False):
            with self.assertRaises(ImproperlyConfigured):
                env_secret('SHORT_SECRET', min_length=50)

    def test_base64_key_requires_exact_byte_length(self):
        valid = base64.urlsafe_b64encode(b'x' * 32).decode('ascii')
        invalid = base64.urlsafe_b64encode(b'x' * 16).decode('ascii')
        with patch.dict(os.environ, {'MASTER_KEY': valid}, clear=False):
            self.assertEqual(env_base64_key('MASTER_KEY'), valid)
        with patch.dict(os.environ, {'MASTER_KEY': invalid}, clear=False):
            with self.assertRaises(ImproperlyConfigured):
                env_base64_key('MASTER_KEY')


class DeploymentSettingsTests(SimpleTestCase):
    def test_hardened_profile_passes_django_deployment_checks(self):
        project_root = Path(__file__).resolve().parents[1]
        child_env = os.environ.copy()
        child_env.update(
            {
                'DJANGO_SECRET_KEY': 'deployment-secret-' * 4,
                'JWT_SIGNING_KEY': 'deployment-jwt-signing-key-' * 3,
                'INTEGRATION_ENCRYPTION_KEY': base64.urlsafe_b64encode(
                    b'x' * 32,
                ).decode('ascii'),
                'DJANGO_DEBUG': 'False',
                'DJANGO_ALLOWED_HOSTS': 'crm.example.com',
                'DJANGO_CSRF_TRUSTED_ORIGINS': 'https://crm.example.com',
                'DJANGO_SECURE_SSL_REDIRECT': 'True',
                'DJANGO_SECURE_HSTS_SECONDS': '31536000',
                'DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS': 'True',
                'DJANGO_SECURE_HSTS_PRELOAD': 'True',
                'DJANGO_SESSION_COOKIE_SECURE': 'True',
                'DJANGO_CSRF_COOKIE_SECURE': 'True',
                'AUTH_COOKIE_SECURE': 'True',
                'DJANGO_TRUST_PROXY_HEADERS': 'True',
                'REDIS_URL': 'redis://127.0.0.1:6379/0',
                'MEDIA_STORAGE_BACKEND': 's3',
                'S3_BUCKET_NAME': 'prodavan-media',
                'S3_REGION_NAME': 'eu-west-1',
            },
        )

        result = subprocess.run(
            [sys.executable, 'manage.py', 'check', '--deploy'],
            cwd=project_root,
            env=child_env,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=f'{result.stdout}\n{result.stderr}',
        )
        self.assertIn('System check identified no issues', result.stdout)
