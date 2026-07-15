import argparse
import base64
import secrets
from pathlib import Path


def existing_keys(text):
    keys = set()
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        keys.add(line.split('=', 1)[0].strip())
    return keys


def main():
    parser = argparse.ArgumentParser(
        description='Создаёт локальный .env, не перезаписывая существующие значения.',
    )
    parser.add_argument(
        '--path',
        type=Path,
        default=Path(__file__).resolve().parents[1] / '.env',
    )
    args = parser.parse_args()

    path = args.path.resolve()
    current = path.read_text(encoding='utf-8') if path.exists() else ''
    present = existing_keys(current)
    values = {
        'DJANGO_SECRET_KEY': secrets.token_urlsafe(64),
        'DJANGO_DEBUG': 'True',
        'DJANGO_ALLOWED_HOSTS': 'localhost,127.0.0.1',
        'DJANGO_CSRF_TRUSTED_ORIGINS': '',
        'DJANGO_SECURE_SSL_REDIRECT': 'False',
        'DJANGO_SECURE_HSTS_SECONDS': '0',
        'DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS': 'False',
        'DJANGO_SECURE_HSTS_PRELOAD': 'False',
        'DJANGO_SESSION_COOKIE_SECURE': 'False',
        'DJANGO_SESSION_COOKIE_SAMESITE': 'Lax',
        'DJANGO_CSRF_COOKIE_SECURE': 'False',
        'DJANGO_CSRF_COOKIE_SAMESITE': 'Lax',
        'DJANGO_SECURE_REFERRER_POLICY': 'strict-origin-when-cross-origin',
        'DJANGO_TRUST_PROXY_HEADERS': 'False',
        'DJANGO_USE_X_FORWARDED_HOST': 'False',
        'DATABASE_ENGINE': 'sqlite',
        'DATABASE_NAME': '',
        'DATABASE_USER': '',
        'DATABASE_PASSWORD': '',
        'DATABASE_HOST': '',
        'DATABASE_PORT': '5432',
        'DATABASE_SSLMODE': 'require',
        'DATABASE_CONNECT_TIMEOUT': '10',
        'DATABASE_CONN_MAX_AGE': '60',
        'DATABASE_APPLICATION_NAME': 'prodavan',
        'LOG_LEVEL': 'DEBUG',
        'LOG_FORMAT': 'console',
        'JWT_SIGNING_KEY': secrets.token_urlsafe(64),
        'JWT_ACCESS_MINUTES': '30',
        'JWT_REFRESH_DAYS': '7',
        'INTEGRATION_ENCRYPTION_KEY': base64.urlsafe_b64encode(
            secrets.token_bytes(32),
        ).decode('ascii'),
        'INTEGRATION_ENCRYPTION_KEY_ID': 'v1',
        'TELEGRAM_API_BASE_URL': 'https://api.telegram.org',
        'TELEGRAM_REQUEST_TIMEOUT': '10',
        'TELEGRAM_WEBHOOK_BASE_URL': '',
        'CHANNEL_REDIS_URL': '',
        'AI_EMBEDDINGS_BASE_URL': '',
        'AI_EMBEDDINGS_API_KEY': '',
        'AI_EMBEDDINGS_MODEL': '',
        'AI_EMBEDDINGS_TIMEOUT': '30',
        'AI_EMBEDDINGS_BATCH_SIZE': '32',
        'AI_CHAT_BASE_URL': '',
        'AI_CHAT_API_KEY': '',
        'AI_CHAT_MODEL': '',
        'AI_CHAT_PROVIDER': 'openai-compatible',
        'AI_CHAT_TIMEOUT': '30',
        'AI_CHAT_RETRY_ATTEMPTS': '3',
        'AI_CHAT_MAX_CONTEXT_TOKENS': '20000',
        'AI_CHAT_RETRIEVAL_LIMIT': '5',
        'AI_RETRIEVAL_MIN_SCORE': '0.2',
        'AUTH_REFRESH_COOKIE_NAME': 'refresh',
        'AUTH_COOKIE_SECURE': 'False',
        'AUTH_COOKIE_SAMESITE': 'Lax',
        'EMAIL_BACKEND': 'django.core.mail.backends.console.EmailBackend',
        'DEFAULT_FROM_EMAIL': 'noreply@localhost',
        'EMAIL_HOST': '',
        'EMAIL_PORT': '587',
        'EMAIL_USE_TLS': 'True',
        'EMAIL_HOST_USER': '',
        'EMAIL_HOST_PASSWORD': '',
    }
    missing = [(key, value) for key, value in values.items() if key not in present]
    if not missing:
        print(f'{path}: все переменные уже присутствуют.')
        return

    prefix = current.rstrip()
    generated = '\n'.join(f'{key}={value}' for key, value in missing)
    content = f'{prefix}\n\n{generated}\n' if prefix else f'{generated}\n'
    path.write_text(content, encoding='utf-8')
    print(f'{path}: добавлены переменные: {", ".join(key for key, _ in missing)}')


if __name__ == '__main__':
    main()
