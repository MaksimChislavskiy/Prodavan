import json
import logging
import os
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase
from django.urls import reverse

from config.observability import (
    JsonFormatter,
    RequestContextFilter,
    SensitiveDataFilter,
    build_logging_config,
    current_request_id,
    request_id_context,
)


class RequestIdMiddlewareTests(SimpleTestCase):
    def test_response_receives_generated_request_id(self):
        response = self.client.get(reverse('health-live'))

        request_id = response.headers['X-Request-ID']
        self.assertEqual(str(uuid.UUID(request_id)), request_id)
        self.assertEqual(current_request_id(), '-')

    def test_valid_client_request_id_is_preserved(self):
        response = self.client.get(
            reverse('health-live'),
            headers={'X-Request-ID': 'trace-123_ABC:span'},
        )

        self.assertEqual(
            response.headers['X-Request-ID'],
            'trace-123_ABC:span',
        )

    def test_invalid_client_request_id_is_replaced(self):
        response = self.client.get(
            reverse('health-live'),
            headers={'X-Request-ID': 'invalid request id'},
        )

        request_id = response.headers['X-Request-ID']
        self.assertNotEqual(request_id, 'invalid request id')
        self.assertEqual(str(uuid.UUID(request_id)), request_id)

    def test_oversized_client_request_id_is_replaced(self):
        response = self.client.get(
            reverse('health-live'),
            headers={'X-Request-ID': 'a' * 65},
        )

        self.assertNotEqual(response.headers['X-Request-ID'], 'a' * 65)


class LoggingConfigurationTests(SimpleTestCase):
    def test_request_context_filter_uses_context_local_request_id(self):
        record = logging.LogRecord(
            name='prodavan.test',
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg='test',
            args=(),
            exc_info=None,
        )

        with request_id_context('trace-123'):
            self.assertTrue(RequestContextFilter().filter(record))
            self.assertEqual(record.request_id, 'trace-123')

        self.assertEqual(current_request_id(), '-')

    def test_request_context_filter_uses_request_for_late_django_logs(self):
        record = logging.LogRecord(
            name='django.request',
            level=logging.WARNING,
            pathname=__file__,
            lineno=1,
            msg='Bad Request',
            args=(),
            exc_info=None,
        )
        record.request = SimpleNamespace(request_id='trace-late')

        self.assertTrue(RequestContextFilter().filter(record))

        self.assertEqual(record.request_id, 'trace-late')

    def test_sensitive_data_filter_redacts_secret_urls(self):
        record = logging.LogRecord(
            name='django.request',
            level=logging.WARNING,
            pathname=__file__,
            lineno=1,
            msg=(
                'Forbidden: /api/integrations/telegram/webhook/%s'
                '?access_token=%s'
            ),
            args=('workspace-secret', 'api-secret'),
            exc_info=None,
        )

        self.assertTrue(SensitiveDataFilter().filter(record))
        message = record.getMessage()

        self.assertIn('/webhook/[REDACTED]', message)
        self.assertIn('access_token=[REDACTED]', message)
        self.assertNotIn('workspace-secret', message)
        self.assertNotIn('api-secret', message)

    def test_json_formatter_emits_stable_structured_fields(self):
        record = logging.LogRecord(
            name='prodavan.test',
            level=logging.WARNING,
            pathname=__file__,
            lineno=1,
            msg='Сервис недоступен: %s',
            args=('database',),
            exc_info=None,
        )
        record.request_id = 'trace-123'

        payload = json.loads(JsonFormatter().format(record))

        self.assertEqual(payload['level'], 'WARNING')
        self.assertEqual(payload['logger'], 'prodavan.test')
        self.assertEqual(payload['message'], 'Сервис недоступен: database')
        self.assertEqual(payload['request_id'], 'trace-123')
        self.assertTrue(payload['timestamp'].endswith('Z'))

    def test_production_defaults_to_info_json_logs(self):
        with patch.dict(os.environ, {}, clear=True):
            config = build_logging_config(debug=False)

        self.assertEqual(config['root']['level'], 'INFO')
        self.assertEqual(config['handlers']['console']['formatter'], 'json')

    def test_invalid_log_level_is_rejected(self):
        with patch.dict(os.environ, {'LOG_LEVEL': 'verbose'}, clear=True):
            with self.assertRaisesMessage(
                ImproperlyConfigured,
                'LOG_LEVEL',
            ):
                build_logging_config(debug=False)
