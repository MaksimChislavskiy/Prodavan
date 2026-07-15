import logging
import uuid

from django.core.cache import cache
from django.core.files.storage import default_storage
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe


logger = logging.getLogger(__name__)


def _health_response(*, status, status_code=200, checks=None):
    payload = {
        'status': status,
        'service': 'prodavan',
    }
    if checks is not None:
        payload['checks'] = checks
    return JsonResponse(payload, status=status_code)


@require_safe
@never_cache
def liveness(request):
    """Confirms that the Django process can serve HTTP requests."""
    return _health_response(status='ok')


@require_safe
@never_cache
def readiness(request):
    """Confirms that mandatory backend dependencies are available."""
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
    except Exception as error:  # readiness must convert dependency failures to 503
        logger.warning(
            'Database readiness check failed (%s)',
            error.__class__.__name__,
        )
        return _health_response(
            status='unavailable',
            status_code=503,
            checks={'database': 'unavailable'},
        )

    cache_key = f'health:{uuid.uuid4().hex}'
    cache_value = uuid.uuid4().hex
    cache_written = False
    try:
        cache.set(cache_key, cache_value, timeout=5)
        cache_written = True
        if cache.get(cache_key) != cache_value:
            raise RuntimeError('Cache health check value mismatch')
        cache.delete(cache_key)
        cache_written = False
    except Exception as error:  # readiness must hide infrastructure details
        if cache_written:
            try:
                cache.delete(cache_key)
            except Exception:
                pass
        logger.warning(
            'Cache readiness check failed (%s)',
            error.__class__.__name__,
        )
        return _health_response(
            status='unavailable',
            status_code=503,
            checks={
                'database': 'ok',
                'cache': 'unavailable',
            },
        )

    try:
        default_storage.exists('.prodavan-healthcheck')
    except Exception as error:  # readiness must hide storage credentials
        logger.warning(
            'Storage readiness check failed (%s)',
            error.__class__.__name__,
        )
        return _health_response(
            status='unavailable',
            status_code=503,
            checks={
                'database': 'ok',
                'cache': 'ok',
                'storage': 'unavailable',
            },
        )

    return _health_response(
        status='ok',
        checks={
            'database': 'ok',
            'cache': 'ok',
            'storage': 'ok',
        },
    )
