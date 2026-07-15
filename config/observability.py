import json
import logging
import re
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone

from django.core.exceptions import ImproperlyConfigured

from config.env import env


REQUEST_ID_HEADER = 'X-Request-ID'
REQUEST_ID_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$')
TELEGRAM_WEBHOOK_PATTERN = re.compile(
    r'(/api/integrations/telegram/webhook/)[^/?\s]+',
)
SENSITIVE_QUERY_PATTERN = re.compile(
    r'([?&](?:access_token|api_key|code|password|refresh_token|secret|token)=)'
    r'[^&\s]+',
    flags=re.IGNORECASE,
)
LOG_LEVELS = {'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'}
LOG_FORMATS = {'console', 'json'}

_request_id = ContextVar('request_id', default=None)


def current_request_id():
    return _request_id.get() or '-'


def normalized_request_id(value):
    if value and REQUEST_ID_PATTERN.fullmatch(value):
        return value
    return str(uuid.uuid4())


def redact_log_message(message):
    message = TELEGRAM_WEBHOOK_PATTERN.sub(r'\1[REDACTED]', message)
    return SENSITIVE_QUERY_PATTERN.sub(r'\1[REDACTED]', message)


@contextmanager
def request_id_context(request_id):
    token = _request_id.set(request_id)
    try:
        yield
    finally:
        _request_id.reset(token)


class RequestIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = normalized_request_id(
            request.headers.get(REQUEST_ID_HEADER),
        )
        request.request_id = request_id
        with request_id_context(request_id):
            response = self.get_response(request)
            response[REQUEST_ID_HEADER] = request_id
            return response


class RequestContextFilter(logging.Filter):
    def filter(self, record):
        request_id = current_request_id()
        request = getattr(record, 'request', None)
        if request_id == '-' and request is not None:
            request_id = getattr(request, 'request_id', '-')
        record.request_id = request_id
        return True


class SensitiveDataFilter(logging.Filter):
    def filter(self, record):
        message = redact_log_message(record.getMessage())
        record.msg = message
        record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record):
        payload = {
            'timestamp': datetime.fromtimestamp(
                record.created,
                tz=timezone.utc,
            ).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'level': record.levelname,
            'logger': record.name,
            'message': redact_log_message(record.getMessage()),
            'request_id': getattr(record, 'request_id', '-'),
        }
        if record.exc_info:
            payload['exception'] = redact_log_message(
                self.formatException(record.exc_info),
            )
        return json.dumps(payload, ensure_ascii=False)


def build_logging_config(*, debug):
    level = env('LOG_LEVEL', 'DEBUG' if debug else 'INFO').strip().upper()
    if level not in LOG_LEVELS:
        raise ImproperlyConfigured(
            f'LOG_LEVEL должен быть одним из: {", ".join(sorted(LOG_LEVELS))}.',
        )

    output_format = env(
        'LOG_FORMAT',
        'console' if debug else 'json',
    ).strip().lower()
    if output_format not in LOG_FORMATS:
        raise ImproperlyConfigured(
            'LOG_FORMAT должен быть console или json.',
        )

    return {
        'version': 1,
        'disable_existing_loggers': False,
        'filters': {
            'request_context': {
                '()': 'config.observability.RequestContextFilter',
            },
            'sensitive_data': {
                '()': 'config.observability.SensitiveDataFilter',
            },
        },
        'formatters': {
            'console': {
                'format': (
                    '%(levelname)s %(name)s '
                    '[request_id=%(request_id)s] %(message)s'
                ),
            },
            'json': {
                '()': 'config.observability.JsonFormatter',
            },
        },
        'handlers': {
            'console': {
                'class': 'logging.StreamHandler',
                'stream': 'ext://sys.stdout',
                'filters': ['request_context', 'sensitive_data'],
                'formatter': output_format,
            },
        },
        'root': {
            'handlers': ['console'],
            'level': level,
        },
        'loggers': {
            'django': {
                'handlers': ['console'],
                'level': level,
                'propagate': False,
            },
            'django.server': {
                'handlers': ['console'],
                'level': level,
                'propagate': False,
            },
            'django.db.backends': {
                'handlers': ['console'],
                'level': 'WARNING',
                'propagate': False,
            },
            'PIL': {
                'handlers': ['console'],
                'level': 'WARNING',
                'propagate': False,
            },
            'asyncio': {
                'handlers': ['console'],
                'level': 'WARNING',
                'propagate': False,
            },
        },
    }
