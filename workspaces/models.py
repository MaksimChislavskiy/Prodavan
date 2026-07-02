import uuid

from django.conf import settings
from django.db import models

from config.mixins import TimestampMixin


def default_company_details():
    return {
        'full_name': '',
        'short_name': None,
        'legal_address': None,
        'postal_address': None,
        'inn': None,
        'kpp': None,
        'ogrn': None,
        'okved': None,
        'okpo': None,
    }


class IntegrationType(models.TextChoices):
    TELEGRAM = 'telegram', 'Telegram'
    WHATSAPP = 'whatsapp', 'WhatsApp'
    EMAIL = 'email', 'Email'


class IntegrationStatus(models.TextChoices):
    CONNECTED = 'connected', 'Подключено'
    DISCONNECTED = 'disconnected', 'Отключено'


class IntegrationHealth(models.TextChoices):
    HEALTHY = 'healthy', 'Работает'
    DEGRADED = 'degraded', 'Есть проблемы'
    ERROR = 'error', 'Ошибка'


class Workspace(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, verbose_name='Название')
    timezone = models.CharField(max_length=64, default='UTC')
    language = models.CharField(max_length=8, default='ru')
    version = models.PositiveIntegerField(default=0)
    company = models.JSONField(default=default_company_details)

    class Meta:
        db_table = 'workspaces'
        verbose_name = 'Рабочее пространство'
        verbose_name_plural = 'Рабочие пространства'
        ordering = ('name',)

    def __str__(self):
        return self.name


class WorkspaceIntegration(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name='integrations',
    )
    type = models.CharField(max_length=32, choices=IntegrationType.choices)
    status = models.CharField(
        max_length=16,
        choices=IntegrationStatus.choices,
        default=IntegrationStatus.DISCONNECTED,
        db_index=True,
    )
    health_status = models.CharField(
        max_length=16,
        choices=IntegrationHealth.choices,
        null=True,
        blank=True,
    )
    config = models.JSONField(default=dict, blank=True)
    bot_username = models.CharField(max_length=255, blank=True, default='')
    connected_at = models.DateTimeField(null=True, blank=True)
    last_check_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_error = models.TextField(blank=True, default='')
    consecutive_failures = models.PositiveSmallIntegerField(default=0)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'workspace_integrations'
        ordering = ('type',)
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'type'),
                name='unique_workspace_integration_type',
            ),
        ]


class WorkspaceAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='workspace_audit_logs',
    )
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_logs',
    )
    user_identifier = models.UUIDField(db_index=True)
    workspace_identifier = models.UUIDField(db_index=True)
    field = models.CharField(max_length=128)
    old_value = models.TextField(null=True, blank=True)
    new_value = models.TextField(null=True, blank=True)
    changed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    request_id = models.UUIDField(default=uuid.uuid4, db_index=True)

    class Meta:
        db_table = 'workspace_audit_log'
        ordering = ('-changed_at',)


class WorkspaceIdempotencyRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name='idempotency_records',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='workspace_idempotency_records',
    )
    key = models.UUIDField()
    request_hash = models.CharField(max_length=64)
    response_body = models.JSONField()
    response_status = models.PositiveSmallIntegerField(default=200)
    response_etag = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        db_table = 'workspace_idempotency_records'
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'key'),
                name='unique_workspace_idempotency_key',
            ),
        ]
