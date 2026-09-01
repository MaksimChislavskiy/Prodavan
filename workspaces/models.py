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
    is_active = models.BooleanField(default=True, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'workspaces'
        verbose_name = 'Рабочее пространство'
        verbose_name_plural = 'Рабочие пространства'
        ordering = ('name',)

    def __str__(self):
        return self.name


class OnboardingAuditEvent(models.TextChoices):
    UPLOAD_STARTED = 'onboarding_upload_started', 'Загрузка начата'
    UPLOAD_SUCCESS = 'onboarding_upload_success', 'Загрузка принята'
    UPLOAD_FAILED = 'onboarding_upload_failed', 'Ошибка загрузки'
    VIDEO_OPENED = 'onboarding_video_opened', 'Видео открыто'
    PDF_OPENED = 'onboarding_pdf_opened', 'PDF открыт'
    MATERIALS_VIEWED = 'onboarding_materials_viewed', 'Материалы просмотрены'
    COMPLETED = 'onboarding_completed', 'Онбординг завершён'


class WorkspaceOnboarding(TimestampMixin):
    workspace = models.OneToOneField(
        Workspace,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name='onboarding',
    )
    completed = models.BooleanField(
        default=False,
        db_column='onboarding_completed',
    )
    completed_at = models.DateTimeField(
        null=True,
        blank=True,
        db_column='onboarding_completed_at',
    )
    materials_viewed = models.BooleanField(
        default=False,
        db_column='onboarding_materials_viewed',
    )

    class Meta:
        db_table = 'workspace_onboarding'


class WorkspaceOnboardingAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='onboarding_audit_logs',
    )
    workspace_identifier = models.UUIDField(db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='onboarding_audit_logs',
    )
    user_identifier = models.UUIDField(null=True, blank=True, db_index=True)
    event = models.CharField(
        max_length=64,
        choices=OnboardingAuditEvent.choices,
        db_index=True,
    )
    details = models.JSONField(default=dict, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default='')
    correlation_id = models.UUIDField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'workspace_onboarding_audit_log'
        ordering = ('-created_at', '-id')


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
    credential_fingerprint = models.CharField(
        max_length=64,
        blank=True,
        default='',
        db_index=True,
    )
    webhook_secret_config = models.JSONField(default=dict, blank=True)
    webhook_secret_hash = models.CharField(
        max_length=64,
        blank=True,
        default='',
        db_index=True,
    )
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
            models.UniqueConstraint(
                fields=('credential_fingerprint',),
                condition=(
                    models.Q(type=IntegrationType.TELEGRAM)
                    & ~models.Q(credential_fingerprint='')
                ),
                name='unique_telegram_credential_fingerprint',
            ),
            models.UniqueConstraint(
                fields=('webhook_secret_hash',),
                condition=(
                    models.Q(type=IntegrationType.TELEGRAM)
                    & ~models.Q(webhook_secret_hash='')
                ),
                name='unique_telegram_webhook_secret_hash',
            ),
        ]


class TelegramWebhookLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name='telegram_webhook_logs',
    )
    update_id = models.BigIntegerField()
    payload = models.JSONField()
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)
    processed = models.BooleanField(default=False, db_index=True)
    processing_error = models.TextField(blank=True, default='')
    processing_attempts = models.PositiveSmallIntegerField(default=0)
    failed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = 'telegram_webhook_log'
        ordering = ('-received_at', '-id')
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'update_id'),
                name='unique_telegram_update_per_workspace',
            ),
        ]
