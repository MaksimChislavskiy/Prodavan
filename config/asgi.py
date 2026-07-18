import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application


os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

django_asgi_application = get_asgi_application()

from messaging.auth_middleware import JWTAuthMiddleware  # noqa: E402
from messaging.routing import websocket_urlpatterns as chat_patterns  # noqa: E402
from notifications.routing import (  # noqa: E402
    websocket_urlpatterns as notification_patterns,
)


websocket_urlpatterns = [*chat_patterns, *notification_patterns]


application = ProtocolTypeRouter(
    {
        'http': django_asgi_application,
        'websocket': AllowedHostsOriginValidator(
            JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
        ),
    },
)
