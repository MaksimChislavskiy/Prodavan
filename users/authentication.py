from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed


class VersionedJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        token_version = validated_token.payload.get('token_version')
        if token_version != user.token_version:
            raise AuthenticationFailed(
                'Сессия недействительна. Выполните вход повторно.',
                code='session_invalid',
            )
        if not user.is_confirmed:
            raise AuthenticationFailed(
                'E-mail не подтверждён.',
                code='email_not_confirmed',
            )
        return user
