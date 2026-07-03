import time

from django.core.cache import cache
from rest_framework.throttling import BaseThrottle


class SlidingWindowThrottle(BaseThrottle):
    limit = 1
    duration = 1
    scope = 'default'

    def allow_request(self, request, view):
        chat_id = view.kwargs.get('chat_id')
        workspace_id = getattr(request.user, 'workspace_id', None)
        if chat_id is None or workspace_id is None:
            return True
        ident = self.get_ident_value(workspace_id, chat_id)
        key = f'throttle_{self.scope}_{ident}'
        now = time.monotonic()
        history = cache.get(key, [])
        history = [value for value in history if value > now - self.duration]
        if len(history) >= self.limit:
            self._wait = max(0, self.duration - (now - history[0]))
            return False
        history.append(now)
        cache.set(key, history, timeout=self.duration)
        self._wait = None
        return True

    def get_ident_value(self, workspace_id, chat_id):
        raise NotImplementedError

    def wait(self):
        return self._wait


class ChatMessageThrottle(SlidingWindowThrottle):
    limit = 20
    duration = 10
    scope = 'chat_message_10s'

    def get_ident_value(self, workspace_id, chat_id):
        return f'{workspace_id}_{chat_id}'


class WorkspaceTelegramMessageThrottle(SlidingWindowThrottle):
    limit = 20
    duration = 60
    scope = 'workspace_message_60s'

    def get_ident_value(self, workspace_id, chat_id):
        return str(workspace_id)
