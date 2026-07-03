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
