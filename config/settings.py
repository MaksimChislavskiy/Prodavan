# config/settings.py
from datetime import timedelta
from pathlib import Path

from config.database import build_database_config
from config.observability import build_logging_config
from config.redis_config import build_redis_config
from config.storage_config import build_storage_config
from config.env import (
    env,
    env_base64_key,
    env_bool,
    env_float,
    env_int,
    env_list,
    env_secret,
    load_env_file,
)

BASE_DIR = Path(__file__).resolve().parent.parent
load_env_file(BASE_DIR / '.env')

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = env_secret('DJANGO_SECRET_KEY', min_length=50)
JWT_SIGNING_KEY = env_secret('JWT_SIGNING_KEY', min_length=50)
INTEGRATION_ENCRYPTION_KEY = env_base64_key(
    'INTEGRATION_ENCRYPTION_KEY',
    expected_bytes=32,
)
INTEGRATION_ENCRYPTION_KEY_ID = env('INTEGRATION_ENCRYPTION_KEY_ID', 'v1')
TELEGRAM_API_BASE_URL = env(
    'TELEGRAM_API_BASE_URL',
    'https://api.telegram.org',
).rstrip('/')
TELEGRAM_REQUEST_TIMEOUT = env_int('TELEGRAM_REQUEST_TIMEOUT', 10)
TELEGRAM_WEBHOOK_BASE_URL = env('TELEGRAM_WEBHOOK_BASE_URL', '').rstrip('/')
CHAT_RETURNED_AFTER_DAYS = max(1, env_int('CHAT_RETURNED_AFTER_DAYS', 7))
CHAT_MISSED_AFTER_MINUTES = max(1, env_int('CHAT_MISSED_AFTER_MINUTES', 15))
AI_EMBEDDINGS_BASE_URL = env('AI_EMBEDDINGS_BASE_URL', '').rstrip('/')
AI_EMBEDDINGS_API_KEY = env('AI_EMBEDDINGS_API_KEY', '')
AI_EMBEDDINGS_MODEL = env('AI_EMBEDDINGS_MODEL', '')
AI_EMBEDDINGS_TIMEOUT = env_int('AI_EMBEDDINGS_TIMEOUT', 30)
AI_EMBEDDINGS_BATCH_SIZE = env_int('AI_EMBEDDINGS_BATCH_SIZE', 32)
AI_CHAT_BASE_URL = env('AI_CHAT_BASE_URL', '').rstrip('/')
AI_CHAT_API_KEY = env('AI_CHAT_API_KEY', '')
AI_CHAT_MODEL = env('AI_CHAT_MODEL', '')
AI_CHAT_PROVIDER = env('AI_CHAT_PROVIDER', 'openai-compatible')
AI_CHAT_TIMEOUT = env_int('AI_CHAT_TIMEOUT', 30)
AI_CHAT_RETRY_ATTEMPTS = env_int('AI_CHAT_RETRY_ATTEMPTS', 3)
AI_CHAT_MAX_CONTEXT_TOKENS = env_int('AI_CHAT_MAX_CONTEXT_TOKENS', 20_000)
AI_CHAT_RETRIEVAL_LIMIT = env_int('AI_CHAT_RETRIEVAL_LIMIT', 5)
AI_RETRIEVAL_MIN_SCORE = env_float('AI_RETRIEVAL_MIN_SCORE', 0.2)
AI_AUTOMATION_CONFIDENCE_THRESHOLD = env_float(
    'AI_AUTOMATION_CONFIDENCE_THRESHOLD',
    0.7,
)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env_bool('DJANGO_DEBUG', False)
LOGGING = build_logging_config(debug=DEBUG)
REDIS_CONFIG = build_redis_config(debug=DEBUG)
CHANNEL_REDIS_URL = REDIS_CONFIG['channel_url']
CACHE_REDIS_URL = REDIS_CONFIG['cache_url']
CHANNEL_LAYERS = REDIS_CONFIG['channel_layers']
CACHES = REDIS_CONFIG['caches']
STORAGE_CONFIG = build_storage_config(BASE_DIR, debug=DEBUG)
STORAGES = STORAGE_CONFIG['storages']

ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS', ('localhost', '127.0.0.1'))
CSRF_TRUSTED_ORIGINS = env_list('DJANGO_CSRF_TRUSTED_ORIGINS')

# Production transport and cookie security. Local development stays available
# over HTTP while DEBUG=True; every setting can be overridden explicitly.
SECURE_SSL_REDIRECT = env_bool('DJANGO_SECURE_SSL_REDIRECT', not DEBUG)
SECURE_HSTS_SECONDS = max(
    0,
    env_int('DJANGO_SECURE_HSTS_SECONDS', 0 if DEBUG else 31_536_000),
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool(
    'DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS',
    not DEBUG,
)
SECURE_HSTS_PRELOAD = env_bool('DJANGO_SECURE_HSTS_PRELOAD', not DEBUG)
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = env(
    'DJANGO_SECURE_REFERRER_POLICY',
    'strict-origin-when-cross-origin',
)

SESSION_COOKIE_SECURE = env_bool('DJANGO_SESSION_COOKIE_SECURE', not DEBUG)
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = env('DJANGO_SESSION_COOKIE_SAMESITE', 'Lax')
CSRF_COOKIE_SECURE = env_bool('DJANGO_CSRF_COOKIE_SECURE', not DEBUG)
CSRF_COOKIE_SAMESITE = env('DJANGO_CSRF_COOKIE_SAMESITE', 'Lax')

# Trust forwarding headers only behind a controlled reverse proxy which
# overwrites them. Enabling this for a directly exposed application is unsafe.
if env_bool('DJANGO_TRUST_PROXY_HEADERS', False):
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    USE_X_FORWARDED_HOST = env_bool('DJANGO_USE_X_FORWARDED_HOST', False)

# Application definition
INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.sites',
    'rest_framework',
    'rest_framework.authtoken',
    'dj_rest_auth',
    'allauth',
    'allauth.account',
    'allauth.socialaccount',
    'channels',
    'users',
    'workspaces',
    'contacts',
    'deals.apps.DealsConfig',
    'tasks.apps.TasksConfig',
    'messaging',
    'notifications',
    'ai_assistant.apps.AiAssistantConfig',
]

MIDDLEWARE = [
    'config.observability.RequestIdMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'allauth.account.middleware.AccountMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Database
DATABASES = build_database_config(BASE_DIR)

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = STORAGE_CONFIG['media_root']

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ========== КАСТОМНЫЕ НАСТРОЙКИ ==========

# Кастомная модель пользователя
AUTH_USER_MODEL = 'users.User'

# Аутентификация через email
AUTHENTICATION_BACKENDS = [
    'django.contrib.auth.backends.ModelBackend',
    'allauth.account.auth_backends.AuthenticationBackend',
]

# DRF настройки
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'users.authentication.VersionedJWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_THROTTLE_RATES': {
        'registration': '5/hour',
        'registration_confirm': '20/hour',
        'password_reset_request': '5/hour',
        'password_reset_confirm': '20/hour',
        'telegram_connect': '10/min',
        'telegram_webhook': '100/sec',
    },
}

# allauth настройки
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
ACCOUNT_LOGIN_METHODS = {'email'}
ACCOUNT_SIGNUP_FIELDS = ['email*', 'password1*', 'password2*']
ACCOUNT_EMAIL_VERIFICATION = 'mandatory'  # или 'optional'
ACCOUNT_CONFIRM_EMAIL_ON_GET = True  # ссылка из письма сразу подтверждает
ACCOUNT_EMAIL_CONFIRMATION_EXPIRE_DAYS = 3  # срок действия ссылки
ACCOUNT_EMAIL_SUBJECT_PREFIX = ''
ACCOUNT_UNIQUE_EMAIL = True
SITE_ID = 1

# Email configuration
EMAIL_BACKEND = env(
    'EMAIL_BACKEND',
    'django.core.mail.backends.console.EmailBackend',
)
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', 'noreply@localhost')
EMAIL_HOST = env('EMAIL_HOST', '')
EMAIL_PORT = env_int('EMAIL_PORT', 587)
EMAIL_USE_TLS = env_bool('EMAIL_USE_TLS', True)
EMAIL_HOST_USER = env('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', '')

# URL для подтверждения email (фронтенд)
ACCOUNT_EMAIL_CONFIRMATION_URL = '/confirm-email/'  # или URL вашего фронтенда
ACCOUNT_EMAIL_CONFIRMATION_AUTHENTICATED_REDIRECT_URL = '/'  # куда редиректить после подтверждения

# Cookie refresh-токена. Access token возвращается только в JSON.
REST_AUTH = {
    'USE_JWT': True,
    'JWT_AUTH_COOKIE': None,
    'JWT_AUTH_REFRESH_COOKIE': env('AUTH_REFRESH_COOKIE_NAME', 'refresh'),
    'JWT_AUTH_HTTPONLY': True,
    'JWT_AUTH_SAMESITE': env('AUTH_COOKIE_SAMESITE', 'Lax'),
    'JWT_AUTH_SECURE': env_bool('AUTH_COOKIE_SECURE', not DEBUG),
    'USER_DETAILS_SERIALIZER': 'users.serializers.UserSerializer',
}

# JWT настройки
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(
        minutes=env_int('JWT_ACCESS_MINUTES', 30),
    ),
    'REFRESH_TOKEN_LIFETIME': timedelta(
        days=env_int('JWT_REFRESH_DAYS', 7),
    ),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'SIGNING_KEY': JWT_SIGNING_KEY,
}
