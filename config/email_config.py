from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.core.validators import validate_email

from config.env import env, env_bool, env_int


EMAIL_BACKENDS = {
    'console': 'django.core.mail.backends.console.EmailBackend',
    'locmem': 'django.core.mail.backends.locmem.EmailBackend',
    'smtp': 'django.core.mail.backends.smtp.EmailBackend',
}
ALLOWED_EMAIL_BACKENDS = set(EMAIL_BACKENDS.values())
SMTP_BACKEND = EMAIL_BACKENDS['smtp']


def _validated_sender(value):
    try:
        validate_email(value)
    except ValidationError as error:
        raise ImproperlyConfigured(
            'DEFAULT_FROM_EMAIL должен быть корректным e-mail адресом.',
        ) from error
    return value


def build_email_config(*, debug):
    raw_backend = env(
        'EMAIL_BACKEND',
        'console' if debug else 'smtp',
    ).strip()
    backend = EMAIL_BACKENDS.get(raw_backend.lower(), raw_backend)
    if backend not in ALLOWED_EMAIL_BACKENDS:
        raise ImproperlyConfigured(
            'EMAIL_BACKEND должен быть smtp, console или locmem.',
        )

    if backend != SMTP_BACKEND:
        if not debug and not env_bool(
            'ALLOW_NON_DELIVERY_EMAIL_BACKEND_IN_PRODUCTION',
            False,
        ):
            raise ImproperlyConfigured(
                'Console/locmem email backend запрещён в production.',
            )
        sender = _validated_sender(
            env('DEFAULT_FROM_EMAIL', 'noreply@localhost').strip(),
        )
        return {
            'EMAIL_BACKEND': backend,
            'DEFAULT_FROM_EMAIL': sender,
            'SERVER_EMAIL': sender,
            'EMAIL_TIMEOUT': min(10, max(1, env_int('EMAIL_TIMEOUT', 10))),
        }

    host = env('EMAIL_HOST', '').strip()
    if not host:
        raise ImproperlyConfigured(
            'EMAIL_HOST обязателен для SMTP backend.',
        )
    if '://' in host or '@' in host:
        raise ImproperlyConfigured(
            'EMAIL_HOST должен содержать только имя SMTP-сервера.',
        )

    port = env_int('EMAIL_PORT', 587)
    if not 1 <= port <= 65_535:
        raise ImproperlyConfigured(
            'EMAIL_PORT должен быть в диапазоне 1–65535.',
        )

    use_tls = env_bool('EMAIL_USE_TLS', True)
    use_ssl = env_bool('EMAIL_USE_SSL', False)
    if use_tls and use_ssl:
        raise ImproperlyConfigured(
            'EMAIL_USE_TLS и EMAIL_USE_SSL нельзя включать одновременно.',
        )
    if not debug and not (use_tls or use_ssl):
        raise ImproperlyConfigured(
            'SMTP-соединение в production должно использовать TLS или SSL.',
        )

    username = env('EMAIL_HOST_USER', '')
    password = env('EMAIL_HOST_PASSWORD', '')
    if bool(username) != bool(password):
        raise ImproperlyConfigured(
            'EMAIL_HOST_USER и EMAIL_HOST_PASSWORD должны быть заданы вместе.',
        )

    sender = env('DEFAULT_FROM_EMAIL', '').strip()
    if not sender:
        raise ImproperlyConfigured(
            'DEFAULT_FROM_EMAIL обязателен для SMTP backend.',
        )
    sender = _validated_sender(sender)

    timeout = env_int('EMAIL_TIMEOUT', 10)
    if not 1 <= timeout <= 10:
        raise ImproperlyConfigured(
            'EMAIL_TIMEOUT должен быть от 1 до 10 секунд.',
        )

    return {
        'EMAIL_BACKEND': backend,
        'DEFAULT_FROM_EMAIL': sender,
        'SERVER_EMAIL': sender,
        'EMAIL_HOST': host,
        'EMAIL_PORT': port,
        'EMAIL_USE_TLS': use_tls,
        'EMAIL_USE_SSL': use_ssl,
        'EMAIL_HOST_USER': username,
        'EMAIL_HOST_PASSWORD': password,
        'EMAIL_TIMEOUT': timeout,
    }
