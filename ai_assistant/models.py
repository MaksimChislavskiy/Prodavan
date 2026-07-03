import uuid

from django.conf import settings
from django.db import models

from config.mixins import TimestampMixin


class AutopilotMode(models.TextChoices):
    ALWAYS = 'always', 'Всегда'
    FALLBACK = 'fallback', 'Если менеджер не ответил'


class AIAuditAction(models.TextChoices):
    INSTRUCTION_UPDATED = 'instruction_updated', 'Изменение инструкции'
    AUTOPILOT_ENABLED = 'autopilot_enabled', 'Включение автопилота'
    AUTOPILOT_DISABLED = 'autopilot_disabled', 'Выключение автопилота'
    AUTOPILOT_UPDATED = 'autopilot_updated', 'Изменение автопилота'


class AISettings(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.OneToOneField(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='ai_settings',
    )
    version = models.PositiveIntegerField(default=0)
    instruction = models.TextField(blank=True, default='')
    autopilot_enabled = models.BooleanField(default=False)
    autopilot_mode = models.CharField(
        max_length=16,
        choices=AutopilotMode.choices,
        default=AutopilotMode.FALLBACK,
    )
    autopilot_delay = models.PositiveSmallIntegerField(default=5)

    class Meta:
        db_table = 'ai_settings'
        verbose_name = 'Настройки AI'
        verbose_name_plural = 'Настройки AI'

    def __str__(self):
        return f'AI settings: {self.workspace_id}'


class AIAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='ai_audit_logs',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ai_audit_logs',
    )
    user_identifier = models.UUIDField(db_index=True)
    action = models.CharField(max_length=32, choices=AIAuditAction.choices)
    changes = models.JSONField(default=dict, blank=True)
    request_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'ai_audit_log'
        ordering = ('-created_at', '-id')


class AIUsageDaily(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='ai_daily_usage',
    )
    date = models.DateField(db_index=True)
    deals_created = models.PositiveIntegerField(default=0)
    tasks_created = models.PositiveIntegerField(default=0)
    contacts_updated = models.PositiveIntegerField(default=0)
    autopilot_replies = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'ai_usage_daily'
        ordering = ('-date',)
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'date'),
                name='unique_ai_usage_workspace_date',
            ),
        ]
