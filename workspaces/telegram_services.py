import hashlib
import hmac
import json
import secrets
import uuid
from urllib.parse import urlparse

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from .crypto import (
    IntegrationSecretError,
    decrypt_integration_secret,
    encrypt_integration_secret,
)
from .models import (
    IntegrationHealth,
    IntegrationStatus,
    IntegrationType,
    WorkspaceAuditLog,
    WorkspaceIntegration,
    TelegramWebhookLog,
)
from .serializers import WorkspaceIntegrationSerializer
from .telegram import (
    TelegramApiUnavailable,
    TelegramBotApiClient,
    TelegramInvalidToken,
    TelegramWebhookRejected,
)


class TelegramIntegrationError(Exception):
    def __init__(self, code, message, *, status_code=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code

    @property
    def response_data(self):
        return {'error': {'code': self.code, 'message': self.message}}


def _audit(user, workspace, request_id, field, old_value, new_value):
    WorkspaceAuditLog.objects.create(
        user=user,
        workspace=workspace,
        user_identifier=user.id,
        workspace_identifier=workspace.id,
        field=field,
        old_value=old_value,
        new_value=new_value,
        request_id=request_id,
    )


def _audit_payload(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    )


def _webhook_health(webhook_info):
    webhook_url = webhook_info.get('url') or ''
    last_error = webhook_info.get('last_error_message') or ''
    if webhook_url and not last_error:
        return IntegrationHealth.HEALTHY, ''
    if last_error:
        return IntegrationHealth.DEGRADED, 'Telegram сообщает об ошибке webhook.'
    return IntegrationHealth.DEGRADED, 'Webhook не настроен.'


def _fingerprint(value, *, purpose):
    key = settings.INTEGRATION_ENCRYPTION_KEY.encode('ascii')
    return hmac.new(
        key,
        f'{purpose}:{value}'.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()


def _webhook_base_url():
    base_url = settings.TELEGRAM_WEBHOOK_BASE_URL
    parsed = urlparse(base_url)
    if parsed.scheme != 'https' or not parsed.netloc:
        raise TelegramIntegrationError(
            'TELEGRAM_WEBHOOK_URL_NOT_CONFIGURED',
            'Публичный HTTPS-адрес webhook не настроен.',
            status_code=503,
        )
    return base_url


def _webhook_url(base_url, secret):
    return f'{base_url}/api/integrations/telegram/webhook/{secret}'


def _public_data(integration):
    return WorkspaceIntegrationSerializer(integration).data


def connect_telegram(*, workspace, user, bot_token, client=None):
    client = client or TelegramBotApiClient()
    base_url = _webhook_base_url()
    credential_fingerprint = _fingerprint(
        bot_token,
        purpose='telegram-credential',
    )
    if WorkspaceIntegration.objects.filter(
        type=IntegrationType.TELEGRAM,
        credential_fingerprint=credential_fingerprint,
    ).exclude(workspace=workspace).exists():
        raise TelegramIntegrationError(
            'TELEGRAM_TOKEN_ALREADY_IN_USE',
            'Этот Telegram-бот уже подключён к другому workspace.',
            status_code=409,
        )

    try:
        bot = client.get_me(bot_token)
    except TelegramInvalidToken as error:
        raise TelegramIntegrationError(
            'INVALID_TELEGRAM_TOKEN',
            'Telegram-токен недействителен.',
        ) from error
    except TelegramApiUnavailable as error:
        raise TelegramIntegrationError(
            'TELEGRAM_UNAVAILABLE',
            'Telegram временно недоступен. Попробуйте позже.',
            status_code=503,
        ) from error

    webhook_secret = secrets.token_urlsafe(32)
    webhook_url = _webhook_url(base_url, webhook_secret)
    try:
        client.set_webhook(
            bot_token,
            url=webhook_url,
            secret_token=webhook_secret,
        )
        webhook_info = client.get_webhook_info(bot_token)
        health_status, last_error = _webhook_health(webhook_info)
    except TelegramInvalidToken as error:
        raise TelegramIntegrationError(
            'INVALID_TELEGRAM_TOKEN',
            'Telegram-токен недействителен.',
        ) from error
    except TelegramWebhookRejected as error:
        raise TelegramIntegrationError(
            'TELEGRAM_WEBHOOK_REJECTED',
            'Telegram отклонил адрес webhook.',
        ) from error
    except TelegramApiUnavailable as error:
        raise TelegramIntegrationError(
            'TELEGRAM_UNAVAILABLE',
            'Telegram временно недоступен. Попробуйте позже.',
            status_code=503,
        ) from error

    encrypted_config = encrypt_integration_secret(
        secret=bot_token,
        workspace_id=workspace.id,
        integration_type=IntegrationType.TELEGRAM,
    )
    encrypted_webhook_secret = encrypt_integration_secret(
        secret=webhook_secret,
        workspace_id=workspace.id,
        integration_type=IntegrationType.TELEGRAM,
    )
    webhook_secret_hash = _fingerprint(
        webhook_secret,
        purpose='telegram-webhook',
    )
    bot_username = bot.get('username') or ''
    if bot_username and not bot_username.startswith('@'):
        bot_username = f'@{bot_username}'
    now = timezone.now()
    request_id = uuid.uuid4()

    previous = WorkspaceIntegration.objects.filter(
        workspace=workspace,
        type=IntegrationType.TELEGRAM,
    ).first()
    previous_token = None
    if previous is not None and previous.config:
        try:
            previous_token = decrypt_integration_secret(
                envelope=previous.config,
                workspace_id=workspace.id,
                integration_type=IntegrationType.TELEGRAM,
            )
        except IntegrationSecretError:
            previous_token = None

    try:
        with transaction.atomic():
            integration = (
                WorkspaceIntegration.objects.select_for_update()
                .filter(workspace=workspace, type=IntegrationType.TELEGRAM)
                .first()
            )
            created = integration is None
            if created:
                integration = WorkspaceIntegration(
                    workspace=workspace,
                    type=IntegrationType.TELEGRAM,
                )
            old_status = integration.status
            old_health = integration.health_status
            was_connected = (
                not created
                and integration.status == IntegrationStatus.CONNECTED
                and bool(integration.config)
            )
            integration.status = IntegrationStatus.CONNECTED
            integration.health_status = health_status
            integration.config = encrypted_config
            integration.credential_fingerprint = credential_fingerprint
            integration.webhook_secret_config = encrypted_webhook_secret
            integration.webhook_secret_hash = webhook_secret_hash
            integration.bot_username = bot_username
            integration.connected_at = integration.connected_at or now
            integration.last_check_at = now
            integration.last_error = last_error
            integration.consecutive_failures = 0
            integration.deleted_at = None
            integration.save()

            _audit(
                user,
                workspace,
                request_id,
                'telegram_bot_connected',
                None,
                _audit_payload({
                    'bot_username': integration.bot_username,
                    'health_status': integration.health_status,
                    'reconnected': was_connected,
                }),
            )
            _audit(
                user,
                workspace,
                request_id,
                'integration.telegram.token_updated',
                None,
                'changed',
            )
            if old_status != integration.status:
                _audit(
                    user,
                    workspace,
                    request_id,
                    'integration.telegram.status',
                    old_status,
                    integration.status,
                )
            if old_health != integration.health_status:
                _audit(
                    user,
                    workspace,
                    request_id,
                    'integration.telegram.health_status',
                    old_health,
                    integration.health_status,
                )
    except IntegrityError as error:
        try:
            client.delete_webhook(bot_token)
        except (
            TelegramApiUnavailable,
            TelegramInvalidToken,
            TelegramWebhookRejected,
        ):
            pass
        raise TelegramIntegrationError(
            'TELEGRAM_TOKEN_ALREADY_IN_USE',
            'Этот Telegram-бот уже подключён к другому workspace.',
            status_code=409,
        ) from error

    if previous_token and previous_token != bot_token:
        try:
            client.delete_webhook(previous_token)
        except (
            TelegramApiUnavailable,
            TelegramInvalidToken,
            TelegramWebhookRejected,
        ):
            pass

    return _public_data(integration)


def disconnect_telegram(*, workspace, user, client=None):
    client = client or TelegramBotApiClient()
    request_id = uuid.uuid4()
    integration = WorkspaceIntegration.objects.filter(
        workspace=workspace,
        type=IntegrationType.TELEGRAM,
        status=IntegrationStatus.CONNECTED,
    ).first()
    if integration is None:
        raise TelegramIntegrationError(
            'TELEGRAM_NOT_CONNECTED',
            'Telegram-интеграция не найдена.',
            status_code=404,
        )

    cleanup_error = ''
    try:
        bot_token = decrypt_integration_secret(
            envelope=integration.config,
            workspace_id=workspace.id,
            integration_type=IntegrationType.TELEGRAM,
        )
        client.delete_webhook(bot_token)
    except (
        IntegrationSecretError,
        TelegramApiUnavailable,
        TelegramInvalidToken,
        TelegramWebhookRejected,
    ):
        cleanup_error = (
            'Интеграция отключена локально, но Telegram не подтвердил '
            'удаление webhook.'
        )

    with transaction.atomic():
        integration = (
            WorkspaceIntegration.objects.select_for_update()
            .filter(
                workspace=workspace,
                type=IntegrationType.TELEGRAM,
                status=IntegrationStatus.CONNECTED,
            )
            .first()
        )
        if integration is None:
            raise TelegramIntegrationError(
                'TELEGRAM_NOT_CONNECTED',
                'Telegram-интеграция не найдена.',
                status_code=404,
            )
        old_status = integration.status
        old_bot_username = integration.bot_username
        integration.status = IntegrationStatus.DISCONNECTED
        integration.health_status = None
        integration.config = {}
        integration.credential_fingerprint = ''
        integration.webhook_secret_config = {}
        integration.webhook_secret_hash = ''
        integration.bot_username = ''
        integration.last_error = cleanup_error
        integration.consecutive_failures = 0
        integration.save(
            update_fields=(
                'status', 'health_status', 'config',
                'credential_fingerprint', 'webhook_secret_config',
                'webhook_secret_hash', 'bot_username', 'last_error',
                'consecutive_failures', 'updated_at',
            ),
        )
        _audit(
            user,
            workspace,
            request_id,
            'telegram_bot_disconnected',
            None,
            _audit_payload({
                'bot_username': old_bot_username,
                'webhook_cleanup_confirmed': not bool(cleanup_error),
            }),
        )
        _audit(
            user,
            workspace,
            request_id,
            'integration.telegram.status',
            old_status,
            IntegrationStatus.DISCONNECTED,
        )
        _audit(
            user,
            workspace,
            request_id,
            'integration.telegram.token_removed',
            'present',
            None,
        )
    return _public_data(integration)


def get_telegram_settings(*, workspace):
    integration = WorkspaceIntegration.objects.filter(
        workspace=workspace,
        type=IntegrationType.TELEGRAM,
    ).first()
    if integration is not None:
        return _public_data(integration)
    return {
        'type': IntegrationType.TELEGRAM,
        'status': IntegrationStatus.DISCONNECTED,
        'health_status': None,
        'bot_username': '',
        'connected_at': None,
        'last_check_at': None,
        'last_error': '',
        'webhook_configured': False,
    }


def receive_telegram_webhook(*, path_secret, header_secret, payload):
    secret_hash = _fingerprint(
        path_secret,
        purpose='telegram-webhook',
    )
    integration = WorkspaceIntegration.objects.select_related(
        'workspace',
    ).filter(
        type=IntegrationType.TELEGRAM,
        status=IntegrationStatus.CONNECTED,
        webhook_secret_hash=secret_hash,
    ).first()
    if integration is None:
        raise TelegramIntegrationError(
            'INVALID_TELEGRAM_WEBHOOK_SECRET',
            'Webhook не авторизован.',
            status_code=403,
        )

    try:
        expected_secret = decrypt_integration_secret(
            envelope=integration.webhook_secret_config,
            workspace_id=integration.workspace_id,
            integration_type=IntegrationType.TELEGRAM,
        )
    except IntegrationSecretError as error:
        raise TelegramIntegrationError(
            'INVALID_TELEGRAM_WEBHOOK_SECRET',
            'Webhook не авторизован.',
            status_code=403,
        ) from error
    if not (
        hmac.compare_digest(expected_secret, path_secret)
        and header_secret
        and hmac.compare_digest(expected_secret, header_secret)
    ):
        raise TelegramIntegrationError(
            'INVALID_TELEGRAM_WEBHOOK_SECRET',
            'Webhook не авторизован.',
            status_code=403,
        )

    update_id = payload.get('update_id') if isinstance(payload, dict) else None
    if isinstance(update_id, bool) or not isinstance(update_id, int):
        return False
    _, created = TelegramWebhookLog.objects.get_or_create(
        workspace=integration.workspace,
        update_id=update_id,
        defaults={'payload': payload},
    )
    return created


def check_telegram_integration(integration_id, *, client=None):
    client = client or TelegramBotApiClient()
    integration = (
        WorkspaceIntegration.objects.select_related('workspace')
        .filter(
            id=integration_id,
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
        )
        .first()
    )
    if integration is None:
        return False

    try:
        token = decrypt_integration_secret(
            envelope=integration.config,
            workspace_id=integration.workspace_id,
            integration_type=IntegrationType.TELEGRAM,
        )
        client.get_me(token)
        webhook_info = client.get_webhook_info(token)
        next_health, next_error = _webhook_health(webhook_info)
        failed = False
    except (
        IntegrationSecretError,
        TelegramInvalidToken,
        TelegramApiUnavailable,
    ):
        next_health = None
        next_error = 'Не удалось проверить Telegram-интеграцию.'
        failed = True

    now = timezone.now()
    with transaction.atomic():
        current = (
            WorkspaceIntegration.objects.select_for_update()
            .filter(id=integration_id, status=IntegrationStatus.CONNECTED)
            .first()
        )
        if current is None:
            return False
        old_health = current.health_status
        if failed:
            current.consecutive_failures += 1
            current.health_status = (
                IntegrationHealth.ERROR
                if current.consecutive_failures >= 3
                else IntegrationHealth.DEGRADED
            )
        else:
            current.consecutive_failures = 0
            current.health_status = next_health
        current.last_check_at = now
        current.last_error = next_error
        current.save(
            update_fields=(
                'health_status', 'consecutive_failures', 'last_check_at',
                'last_error', 'updated_at',
            ),
        )
        if old_health != current.health_status:
            system_user = current.workspace.users.filter(
                is_active=True,
                role='admin',
            ).first()
            if system_user is not None:
                _audit(
                    system_user,
                    current.workspace,
                    uuid.uuid4(),
                    'integration.telegram.health_status',
                    old_health,
                    current.health_status,
                )
    return True


def check_all_telegram_integrations(*, client=None):
    integration_ids = list(
        WorkspaceIntegration.objects.filter(
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
        ).values_list('id', flat=True),
    )
    checked = 0
    for integration_id in integration_ids:
        if check_telegram_integration(integration_id, client=client):
            checked += 1
    return checked
