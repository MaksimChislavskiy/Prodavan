import uuid
from pathlib import Path

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
    DOCUMENT_UPLOADED = 'document_uploaded', 'Загрузка документа'
    DOCUMENT_DELETED = 'document_deleted', 'Удаление документа'
    DOCUMENT_RETRY = 'document_retry', 'Повторная обработка документа'


class KnowledgeDocumentStatus(models.TextChoices):
    PROCESSING = 'processing', 'Обработка'
    READY = 'ready', 'Готов'
    FAILED = 'failed', 'Ошибка'


def knowledge_document_upload_to(instance, filename):
    extension = Path(instance.original_name or filename).suffix.lower()
    return f'knowledge_base/{instance.workspace_id}/{instance.id}{extension}'


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


class KnowledgeDocument(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='knowledge_documents',
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='uploaded_knowledge_documents',
    )
    uploaded_by_identifier = models.UUIDField(db_index=True)
    original_name = models.CharField(max_length=255)
    file = models.FileField(
        upload_to=knowledge_document_upload_to,
        max_length=500,
    )
    size_bytes = models.PositiveBigIntegerField()
    mime_type = models.CharField(max_length=128)
    sha256 = models.CharField(max_length=64, db_index=True)
    status = models.CharField(
        max_length=16,
        choices=KnowledgeDocumentStatus.choices,
        default=KnowledgeDocumentStatus.PROCESSING,
        db_index=True,
    )
    error_reason = models.TextField(blank=True, default='')
    processing_attempts = models.PositiveSmallIntegerField(default=0)
    processing_started_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'ai_knowledge_document'
        ordering = ('-created_at', '-id')
        indexes = [
            models.Index(
                fields=('workspace', 'is_deleted', 'status'),
                name='ai_doc_workspace_status_idx',
            ),
            models.Index(
                fields=('workspace', 'is_deleted', '-created_at'),
                name='ai_doc_workspace_date_idx',
            ),
        ]

    @property
    def uploaded_at(self):
        return self.created_at

    def __str__(self):
        return self.original_name


class KnowledgeChunk(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        KnowledgeDocument,
        on_delete=models.CASCADE,
        related_name='chunks',
    )
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='knowledge_chunks',
    )
    position = models.PositiveIntegerField()
    text = models.TextField()
    token_count = models.PositiveIntegerField()
    embedding = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'ai_knowledge_chunk'
        ordering = ('position',)
        constraints = [
            models.UniqueConstraint(
                fields=('document', 'position'),
                name='unique_knowledge_document_chunk_position',
            ),
        ]
        indexes = [
            models.Index(
                fields=('workspace', 'document'),
                name='ai_chunk_ws_doc_idx',
            ),
        ]
