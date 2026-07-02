import uuid

from django.db import transaction
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
)
from .serializers import WorkspaceIntegrationSerializer
from .telegram import (
    TelegramApiUnavailable,
    TelegramBotApiClient,
    TelegramInvalidToken,
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


def _webhook_health(webhook_info):
    webhook_url = webhook_info.get('url') or ''
    last_error = webhook_info.get('last_error_message') or ''
    if webhook_url and not last_error:
        return IntegrationHealth.HEALTHY, ''
    if last_error:
        return IntegrationHealth.DEGRADED, 'Telegram сообщает об ошибке webhook.'
    return IntegrationHealth.DEGRADED, 'Webhook не настроен.'


def _public_data(integration):
    return WorkspaceIntegrationSerializer(integration).data


def connect_telegram(*, workspace, user, bot_token, client=None):
    client = client or TelegramBotApiClient()
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

    try:
        webhook_info = client.get_webhook_info(bot_token)
        health_status, last_error = _webhook_health(webhook_info)
    except TelegramInvalidToken as error:
        raise TelegramIntegrationError(
            'INVALID_TELEGRAM_TOKEN',
            'Telegram-токен недействителен.',
        ) from error
    except TelegramApiUnavailable:
        health_status = IntegrationHealth.DEGRADED
        last_error = 'Не удалось проверить webhook.'

    encrypted_config = encrypt_integration_secret(
        secret=bot_token,
        workspace_id=workspace.id,
        integration_type=IntegrationType.TELEGRAM,
    )
    bot_username = bot.get('username') or ''
    if bot_username and not bot_username.startswith('@'):
        bot_username = f'@{bot_username}'
    now = timezone.now()
    request_id = uuid.uuid4()

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
        integration.bot_username = bot_username
        integration.connected_at = integration.connected_at or now
        integration.last_check_at = now
        integration.last_error = last_error
        integration.consecutive_failures = 0
        integration.deleted_at = None
        integration.save()

        action = 'reconnected' if was_connected else 'connected'
        _audit(
            user,
            workspace,
            request_id,
            f'integration.telegram.{action}',
            None,
            action,
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

    return _public_data(integration)


def disconnect_telegram(*, workspace, user):
    request_id = uuid.uuid4()
    with transaction.atomic():
        integration = (
            WorkspaceIntegration.objects.select_for_update()
            .filter(workspace=workspace, type=IntegrationType.TELEGRAM)
            .first()
        )
        if integration is None:
            raise TelegramIntegrationError(
                'TELEGRAM_NOT_CONNECTED',
                'Telegram-интеграция не найдена.',
                status_code=404,
            )
        old_status = integration.status
        integration.status = IntegrationStatus.DISCONNECTED
        integration.health_status = None
        integration.config = {}
        integration.bot_username = ''
        integration.last_error = ''
        integration.consecutive_failures = 0
        integration.save(
            update_fields=(
                'status', 'health_status', 'config', 'bot_username',
                'last_error', 'consecutive_failures', 'updated_at',
            ),
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
