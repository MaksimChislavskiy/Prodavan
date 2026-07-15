from unittest.mock import patch

from django.db import OperationalError
from django.test import SimpleTestCase, TestCase
from django.urls import reverse


class LivenessEndpointTests(SimpleTestCase):
    def test_liveness_is_public_and_does_not_access_database(self):
        response = self.client.get(reverse('health-live'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {'status': 'ok', 'service': 'prodavan'},
        )
        self.assertIn('no-store', response.headers['Cache-Control'])

    def test_liveness_rejects_mutating_methods(self):
        response = self.client.post(reverse('health-live'))

        self.assertEqual(response.status_code, 405)


class ReadinessEndpointTests(TestCase):
    def test_readiness_reports_database_as_available(self):
        response = self.client.get(reverse('health-ready'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                'status': 'ok',
                'service': 'prodavan',
                'checks': {'database': 'ok'},
            },
        )
        self.assertIn('no-store', response.headers['Cache-Control'])

    @patch(
        'config.health_views.connection.cursor',
        side_effect=OperationalError('private database failure details'),
    )
    def test_readiness_returns_sanitized_503_when_database_is_unavailable(
        self,
        cursor,
    ):
        with self.assertLogs('config.health_views', level='WARNING') as logs:
            response = self.client.get(reverse('health-ready'))

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json(),
            {
                'status': 'unavailable',
                'service': 'prodavan',
                'checks': {'database': 'unavailable'},
            },
        )
        self.assertNotIn(
            'private database failure details',
            response.content.decode(),
        )
        self.assertIn('no-store', response.headers['Cache-Control'])
        cursor.assert_called_once_with()
        self.assertIn('OperationalError', logs.output[0])
        self.assertNotIn('private database failure details', logs.output[0])

    def test_readiness_rejects_mutating_methods(self):
        response = self.client.post(reverse('health-ready'))

        self.assertEqual(response.status_code, 405)
