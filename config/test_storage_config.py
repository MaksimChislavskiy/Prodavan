import os
from pathlib import Path
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase
from storages.backends.s3 import S3Storage

from config.storage_config import build_storage_config


class StorageConfigurationTests(SimpleTestCase):
    def test_debug_profile_uses_local_storage_by_default(self):
        with patch.dict(os.environ, {'MEDIA_ROOT': ''}, clear=True):
            config = build_storage_config(Path('project'), debug=True)

        self.assertEqual(config['backend'], 'filesystem')
        self.assertEqual(config['media_root'], Path('project') / 'media')
        self.assertEqual(
            config['storages']['default']['BACKEND'],
            'django.core.files.storage.FileSystemStorage',
        )

    def test_s3_storage_uses_private_signed_urls_and_no_overwrites(self):
        environment = {
            'MEDIA_STORAGE_BACKEND': 's3',
            'S3_BUCKET_NAME': 'prodavan-media',
            'S3_REGION_NAME': 'ru-central1',
            'S3_ENDPOINT_URL': 'https://storage.example.com',
            'S3_ADDRESSING_STYLE': 'path',
        }
        with patch.dict(os.environ, environment, clear=True):
            config = build_storage_config(Path('project'), debug=False)

        storage = config['storages']['default']
        options = storage['OPTIONS']
        self.assertEqual(storage['BACKEND'], 'storages.backends.s3.S3Storage')
        self.assertIsNone(options['default_acl'])
        self.assertTrue(options['querystring_auth'])
        self.assertFalse(options['file_overwrite'])
        self.assertEqual(options['signature_version'], 's3v4')
        self.assertTrue(options['verify'])
        self.assertEqual(options['addressing_style'], 'path')
        self.assertEqual(
            options['object_parameters']['ServerSideEncryption'],
            'AES256',
        )
        self.assertNotIn('access_key', options)
        self.assertNotIn('secret_key', options)

    def test_s3_options_construct_real_storage_backend(self):
        environment = {
            'MEDIA_STORAGE_BACKEND': 's3',
            'S3_BUCKET_NAME': 'prodavan-media',
            'S3_REGION_NAME': 'eu-west-1',
            'S3_ACCESS_KEY_ID': 'test-access',
            'S3_SECRET_ACCESS_KEY': 'test-secret',
        }
        with patch.dict(os.environ, environment, clear=True):
            config = build_storage_config(Path('project'), debug=False)

        storage = S3Storage(**config['storages']['default']['OPTIONS'])

        self.assertEqual(storage.bucket_name, 'prodavan-media')
        self.assertEqual(storage.region_name, 'eu-west-1')
        self.assertTrue(storage.querystring_auth)
        self.assertFalse(storage.file_overwrite)

    def test_s3_credentials_must_be_provided_as_a_pair(self):
        environment = {
            'MEDIA_STORAGE_BACKEND': 's3',
            'S3_BUCKET_NAME': 'prodavan-media',
            'S3_REGION_NAME': 'eu-west-1',
            'S3_ACCESS_KEY_ID': 'access-only',
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'должны быть заданы вместе',
            ):
                build_storage_config(Path('project'), debug=False)

    def test_production_custom_endpoint_requires_https(self):
        environment = {
            'MEDIA_STORAGE_BACKEND': 's3',
            'S3_BUCKET_NAME': 'prodavan-media',
            'S3_REGION_NAME': 'eu-west-1',
            'S3_ENDPOINT_URL': 'http://user:secret@storage.internal',
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaises(ImproperlyConfigured) as error:
                build_storage_config(Path('project'), debug=False)

        self.assertNotIn('secret', str(error.exception))

    def test_production_cannot_disable_s3_tls_verification(self):
        environment = {
            'MEDIA_STORAGE_BACKEND': 's3',
            'S3_BUCKET_NAME': 'prodavan-media',
            'S3_REGION_NAME': 'eu-west-1',
            'S3_VERIFY_TLS': 'False',
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'Проверку TLS для S3 нельзя отключать',
            ):
                build_storage_config(Path('project'), debug=False)

    def test_production_defaults_to_s3_and_requires_bucket(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'S3_BUCKET_NAME обязателен',
            ):
                build_storage_config(Path('project'), debug=False)

    def test_production_rejects_accidental_local_storage(self):
        with patch.dict(
            os.environ,
            {'MEDIA_STORAGE_BACKEND': 'filesystem'},
            clear=True,
        ):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'Локальное MEDIA-хранилище запрещено',
            ):
                build_storage_config(Path('project'), debug=False)
