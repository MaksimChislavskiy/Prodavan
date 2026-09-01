from pathlib import Path

from django.contrib.staticfiles import finders
from django.test import SimpleTestCase


class NewTzAISettingsAssetsTests(SimpleTestCase):
    def test_ai_setup_guide_is_available_as_static_pdf(self):
        asset_path = finders.find('ai_setup_guide.pdf')

        self.assertIsNotNone(asset_path)
        path = Path(asset_path)
        self.assertTrue(path.is_file())
        self.assertGreater(path.stat().st_size, 0)
        self.assertEqual(path.read_bytes()[:5], b'%PDF-')
