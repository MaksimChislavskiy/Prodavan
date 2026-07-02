from rest_framework.throttling import SimpleRateThrottle


class TelegramConnectWorkspaceThrottle(SimpleRateThrottle):
    scope = 'telegram_connect'

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {
            'scope': self.scope,
            'ident': str(request.user.workspace_id),
        }


class TelegramWebhookThrottle(SimpleRateThrottle):
    scope = 'telegram_webhook'

    def get_cache_key(self, request, view):
        return self.cache_format % {
            'scope': self.scope,
            'ident': self.get_ident(request),
        }
