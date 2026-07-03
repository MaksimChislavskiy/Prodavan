from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser

from users.authentication import VersionedJWTAuthentication


def _extract_token(scope):
    headers = dict(scope.get('headers', []))
    authorization = headers.get(b'authorization', b'').decode(
        'utf-8',
        errors='ignore',
    )
    if authorization.lower().startswith('bearer '):
        return authorization[7:].strip(), None

    subprotocols = scope.get('subprotocols', [])
    if len(subprotocols) >= 2 and subprotocols[0].lower() == 'bearer':
        return subprotocols[1], subprotocols[0]

    query = parse_qs(
        scope.get('query_string', b'').decode('utf-8', errors='ignore'),
    )
    values = query.get('token', [])
    return (values[0], None) if values else (None, None)


@database_sync_to_async
def _authenticate(raw_token):
    if not raw_token:
        return AnonymousUser()
    authentication = VersionedJWTAuthentication()
    try:
        validated_token = authentication.get_validated_token(
            raw_token.encode('utf-8'),
        )
        return authentication.get_user(validated_token)
    except Exception:
        return AnonymousUser()


class JWTAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        scope = dict(scope)
        token, accepted_subprotocol = _extract_token(scope)
        scope['user'] = await _authenticate(token)
        scope['accepted_subprotocol'] = accepted_subprotocol
        return await self.app(scope, receive, send)
