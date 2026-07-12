from django.core.cache import cache
from django.utils import timezone

from .limits import AI_LIMITS


class AIRateLimitExceeded(Exception):
    pass


def consume_workspace_ai_request(workspace, *, now=None, limit=None):
    workspace_id = getattr(workspace, 'id', workspace)
    now = now or timezone.now()
    limit = (
        AI_LIMITS['workspace_ai_requests_per_minute']
        if limit is None
        else limit
    )
    if limit < 1:
        raise AIRateLimitExceeded

    minute_bucket = int(now.timestamp() // 60)
    key = f'ai:workspace:{workspace_id}:requests:{minute_bucket}'
    timeout_seconds = 120

    if cache.add(key, 1, timeout=timeout_seconds):
        return 1

    try:
        count = cache.incr(key)
    except ValueError:
        cache.add(key, 1, timeout=timeout_seconds)
        return 1

    if count > limit:
        raise AIRateLimitExceeded
    return count
