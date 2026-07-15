from django.contrib.staticfiles import finders
from django.test import SimpleTestCase
from django.urls import reverse


class LandingPageTests(SimpleTestCase):
    def test_root_renders_public_landing_page(self):
        response = self.client.get(reverse('landing:index'))

        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'landing/index.html')
        self.assertContains(response, 'Сложные процессы —')
        self.assertContains(response, 'Бесплатно 14 дней')
        self.assertContains(response, 'support@prodavan.ru')

    def test_page_has_semantic_landmarks_and_seo_metadata(self):
        response = self.client.get('/')

        self.assertContains(response, '<header', html=False)
        self.assertContains(response, '<main', html=False)
        self.assertContains(response, '<footer', html=False)
        self.assertContains(response, '<title>Продаван — CRM с AI-помощником для продаж</title>', html=True)
        self.assertContains(response, 'name="description"', html=False)
        self.assertContains(response, 'property="og:title"', html=False)
        self.assertContains(response, 'rel="canonical"', html=False)

    def test_auth_controls_expose_stable_action_contracts(self):
        response = self.client.get('/')

        self.assertContains(response, 'data-auth-action="login"', count=1)
        self.assertContains(response, 'data-auth-action="register"', count=2)
        self.assertContains(response, 'data-home-action', count=1)

    def test_landing_assets_are_discoverable(self):
        for asset in (
            'landing/landing.css',
            'landing/landing.js',
            'landing/favicon.svg',
            'landing/og-cover.svg',
        ):
            with self.subTest(asset=asset):
                self.assertIsNotNone(finders.find(asset))
