import os
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.core.mail.backends.smtp import EmailBackend
from django.test import SimpleTestCase

from config.email_config import build_email_config


class EmailConfigurationTests(SimpleTestCase):
    def test_debug_profile_uses_console_backend_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            config = build_email_config(debug=True)

        self.assertEqual(
            config['EMAIL_BACKEND'],
            'django.core.mail.backends.console.EmailBackend',
        )
        self.assertEqual(config['DEFAULT_FROM_EMAIL'], 'noreply@localhost')
        self.assertEqual(config['EMAIL_TIMEOUT'], 10)

    def test_production_rejects_non_delivery_backend(self):
        with patch.dict(
            os.environ,
            {'EMAIL_BACKEND': 'console'},
            clear=True,
        ):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'email backend запрещён в production',
            ):
                build_email_config(debug=False)

    def test_smtp_configuration_constructs_real_django_backend(self):
        environment = {
            'EMAIL_BACKEND': 'smtp',
            'DEFAULT_FROM_EMAIL': 'noreply@prodavan.example',
            'EMAIL_HOST': 'smtp.example.com',
            'EMAIL_PORT': '587',
            'EMAIL_USE_TLS': 'True',
            'EMAIL_USE_SSL': 'False',
            'EMAIL_HOST_USER': 'prodavan',
            'EMAIL_HOST_PASSWORD': 'test-secret',
            'EMAIL_TIMEOUT': '15',
        }
        with patch.dict(os.environ, environment, clear=True):
            config = build_email_config(debug=False)

        backend = EmailBackend(
            host=config['EMAIL_HOST'],
            port=config['EMAIL_PORT'],
            username=config['EMAIL_HOST_USER'],
            password=config['EMAIL_HOST_PASSWORD'],
            use_tls=config['EMAIL_USE_TLS'],
            use_ssl=config['EMAIL_USE_SSL'],
            timeout=config['EMAIL_TIMEOUT'],
        )

        self.assertEqual(backend.host, 'smtp.example.com')
        self.assertEqual(backend.port, 587)
        self.assertTrue(backend.use_tls)
        self.assertFalse(backend.use_ssl)
        self.assertEqual(backend.timeout, 15)

    def test_smtp_requires_host_without_echoing_credentials(self):
        environment = {
            'EMAIL_BACKEND': 'smtp',
            'DEFAULT_FROM_EMAIL': 'noreply@prodavan.example',
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaises(ImproperlyConfigured) as error:
                build_email_config(debug=False)

        self.assertIn('EMAIL_HOST обязателен', str(error.exception))
        self.assertNotIn('noreply@prodavan.example', str(error.exception))

    def test_smtp_rejects_tls_and_ssl_enabled_together(self):
        environment = {
            'EMAIL_BACKEND': 'smtp',
            'DEFAULT_FROM_EMAIL': 'noreply@prodavan.example',
            'EMAIL_HOST': 'smtp.example.com',
            'EMAIL_USE_TLS': 'True',
            'EMAIL_USE_SSL': 'True',
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'нельзя включать одновременно',
            ):
                build_email_config(debug=False)

    def test_production_smtp_requires_encryption(self):
        environment = {
            'EMAIL_BACKEND': 'smtp',
            'DEFAULT_FROM_EMAIL': 'noreply@prodavan.example',
            'EMAIL_HOST': 'smtp.example.com',
            'EMAIL_USE_TLS': 'False',
            'EMAIL_USE_SSL': 'False',
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'должно использовать TLS или SSL',
            ):
                build_email_config(debug=False)

    def test_sender_must_be_valid_email(self):
        environment = {
            'EMAIL_BACKEND': 'smtp',
            'DEFAULT_FROM_EMAIL': 'invalid sender',
            'EMAIL_HOST': 'smtp.example.com',
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'DEFAULT_FROM_EMAIL',
            ):
                build_email_config(debug=False)
