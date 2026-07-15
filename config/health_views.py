import logging

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

    return _health_response(
        status='ok',
        checks={'database': 'ok'},
    )
