import base64
import os
from tempfile import TemporaryDirectory
from pathlib import Path
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
