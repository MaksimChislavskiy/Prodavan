import uuid
from pathlib import Path

from django.conf import settings
from django.db import models
from django.utils import timezone

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


class AIChatSessionStatus(models.TextChoices):
    OPEN = 'open', 'Открыта'
    CLOSED = 'closed', 'Закрыта'


class AIChatRole(models.TextChoices):
    USER = 'user', 'Пользователь'
    ASSISTANT = 'assistant', 'AI'


class AIChatMessageStatus(models.TextChoices):
    PENDING = 'pending', 'Формируется'
    STREAMING = 'streaming', 'Потоковая генерация'
    SUCCESS = 'success', 'Успешно'
    FAILED = 'failed', 'Ошибка'
    TIMEOUT = 'timeout', 'Таймаут'
    CANCELLED = 'cancelled', 'Отменено'


class AIChatContextPage(models.TextChoices):
    DASHBOARD = 'dashboard', 'Рабочий стол'
    DEALS = 'deals', 'Сделки'
    CONTACTS = 'contacts', 'Контакты'
    TASKS = 'tasks', 'Задачи'
    CHAT = 'chat', 'Чат'
    REPORTS = 'reports', 'Отчёты'
    SETTINGS = 'settings', 'Настройки'


class AutomationEventStatus(models.TextChoices):
    PENDING = 'pending', 'Ожидает обработки'
    PROCESSING = 'processing', 'Обрабатывается'
    COMPLETED = 'completed', 'Обработано'
    FAILED = 'failed', 'Ошибка'
    IGNORED = 'ignored', 'Пропущено'


class AutomationActionType(models.TextChoices):
    CONTACT_ENRICHMENT = 'contact_enrichment', 'Обогащение контакта'
    DEAL_CREATE = 'deal_create', 'Создание сделки'
    DEAL_ENRICHMENT = 'deal_enrichment', 'Обогащение сделки'
    TASK_CREATE = 'task_create', 'Создание задачи'
    INSIGHT = 'insight', 'Инсайт по чату'
    AUTOPILOT_REPLY = 'autopilot_reply', 'Ответ автопилота'


class AutomationFailureType(models.TextChoices):
    TECHNICAL = 'technical', 'Техническая ошибка'
    BUSINESS = 'business', 'Бизнес-ошибка'


class AutopilotJobStatus(models.TextChoices):
    PENDING = 'pending', 'Ожидает обработки'
    PROCESSING = 'processing', 'Обрабатывается'
    SENT = 'sent', 'Отправлено'
    SKIPPED = 'skipped', 'Пропущено'
    FAILED = 'failed', 'Ошибка'
    CANCELLED = 'cancelled', 'Отменено'


class AIAutomationAuditAction(models.TextChoices):
    AI_CONTACT_CREATED = 'ai_contact_created', 'AI создал контакт'
    AI_DEAL_CREATED = 'ai_deal_created', 'AI создал сделку'
    AI_TASK_CREATED = 'ai_task_created', 'AI создал задачу'
    AI_CONTACT_UPDATED = 'ai_contact_updated', 'AI обновил контакт'
    AI_DEAL_UPDATED = 'ai_deal_updated', 'AI обновил сделку'
    AI_INSIGHTS_EXTRACTED = 'ai_insights_extracted', 'AI извлёк инсайты'
    AI_AUTOPILOT_SENT = 'ai_autopilot_sent', 'Автопилот отправил ответ'
    AI_DECISION_SKIPPED = 'ai_decision_skipped', 'AI пропустил действие'
    AI_LIMIT_REACHED = 'ai_limit_reached', 'AI достиг лимита'
    AI_ACTION_FAILED = 'ai_action_failed', 'AI-действие завершилось ошибкой'


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


class AIAutomationEvent(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='ai_automation_events',
    )
    chat = models.ForeignKey(
        'messaging.Chat',
        on_delete=models.CASCADE,
        related_name='ai_automation_events',
    )
    message = models.OneToOneField(
        'messaging.Message',
        on_delete=models.CASCADE,
        related_name='ai_automation_event',
    )
    event_type = models.CharField(
        max_length=64,
        default='chat_message_received',
    )
    status = models.CharField(
        max_length=16,
        choices=AutomationEventStatus.choices,
        default=AutomationEventStatus.PENDING,
        db_index=True,
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now, db_index=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    failure_type = models.CharField(
        max_length=16,
        choices=AutomationFailureType.choices,
        blank=True,
        default='',
    )
    last_error = models.TextField(blank=True, default='')
    analysis = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'ai_automation_event'
        ordering = ('available_at', 'created_at', 'id')
        indexes = [
            models.Index(
                fields=('workspace', 'status', 'available_at'),
                name='ai_auto_event_queue_idx',
            ),
            models.Index(
                fields=('chat', '-processed_at'),
                name='ai_auto_event_chat_done_idx',
            ),
        ]


class AIProcessedEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='ai_processed_events',
    )
    event = models.ForeignKey(
        AIAutomationEvent,
        on_delete=models.CASCADE,
        related_name='processed_actions',
    )
    chat = models.ForeignKey(
        'messaging.Chat',
        on_delete=models.CASCADE,
        related_name='ai_processed_events',
    )
    action_type = models.CharField(
        max_length=32,
        choices=AutomationActionType.choices,
    )
    idempotency_key = models.CharField(max_length=64, unique=True)
    result = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        db_table = 'ai_processed_events'
        ordering = ('-created_at', '-id')
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'event', 'action_type'),
                name='unique_ai_processed_event_action',
            ),
        ]
        indexes = [
            models.Index(
                fields=('chat', 'action_type', '-created_at'),
                name='ai_processed_chat_action_idx',
            ),
        ]


class AIChatInsight(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='ai_chat_insights',
    )
    chat = models.ForeignKey(
        'messaging.Chat',
        on_delete=models.CASCADE,
        related_name='ai_insights',
    )
    source_message = models.OneToOneField(
        'messaging.Message',
        on_delete=models.CASCADE,
        related_name='ai_insight',
    )
    message_count = models.PositiveIntegerField(default=0)
    summary = models.TextField(blank=True, default='')
    sentiment = models.CharField(max_length=32, blank=True, default='')
    objections = models.JSONField(default=list, blank=True)
    recommendations = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'ai_chat_insights'
        ordering = ('-created_at', '-id')
        indexes = [
            models.Index(
                fields=('chat', '-created_at'),
                name='ai_insight_chat_created_idx',
            ),
        ]


class AIAutopilotJob(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='ai_autopilot_jobs',
    )
    chat = models.ForeignKey(
        'messaging.Chat',
        on_delete=models.CASCADE,
        related_name='ai_autopilot_jobs',
    )
    trigger_message = models.OneToOneField(
        'messaging.Message',
        on_delete=models.CASCADE,
        related_name='ai_autopilot_job',
    )
    reply_message = models.OneToOneField(
        'messaging.Message',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ai_autopilot_reply_job',
    )
    mode = models.CharField(max_length=16, choices=AutopilotMode.choices)
    status = models.CharField(
        max_length=16,
        choices=AutopilotJobStatus.choices,
        default=AutopilotJobStatus.PENDING,
        db_index=True,
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now, db_index=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    failure_type = models.CharField(
        max_length=16,
        choices=AutomationFailureType.choices,
        blank=True,
        default='',
    )
    last_error = models.TextField(blank=True, default='')
    batched_message_ids = models.JSONField(default=list, blank=True)
    sources = models.JSONField(default=list, blank=True)
    result = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'ai_autopilot_job'
        ordering = ('available_at', 'created_at', 'id')
        indexes = [
            models.Index(
                fields=('workspace', 'status', 'available_at'),
                name='ai_autopilot_queue_idx',
            ),
            models.Index(
                fields=('chat', 'status', 'available_at'),
                name='ai_autopilot_chat_idx',
            ),
            models.Index(
                fields=('chat', '-processed_at'),
                name='ai_autopilot_done_idx',
            ),
        ]


class AIAutomationAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='ai_automation_audit_logs',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ai_automation_audit_logs',
    )
    action = models.CharField(
        max_length=32,
        choices=AIAutomationAuditAction.choices,
        db_index=True,
    )
    action_type = models.CharField(max_length=32, db_index=True)
    trigger = models.CharField(max_length=64, blank=True, default='')
    correlation_id = models.UUIDField(db_index=True)
    chat = models.ForeignKey(
        'messaging.Chat',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ai_audit_logs',
    )
    message = models.ForeignKey(
        'messaging.Message',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ai_audit_logs',
    )
    raw_message = models.TextField(blank=True, default='')
    ai_prompt = models.TextField(blank=True, default='')
    ai_response = models.JSONField(default=dict, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default='')
    confidence = models.FloatField(null=True, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'ai_automation_audit_log'
        ordering = ('-created_at', '-id')
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'correlation_id', 'action_type'),
                name='unique_ai_auto_audit_action',
            ),
        ]
        indexes = [
            models.Index(
                fields=('workspace', '-created_at', '-id'),
                name='ai_auto_audit_ws_created_idx',
            ),
            models.Index(
                fields=('workspace', 'action_type', '-created_at'),
                name='ai_auto_audit_type_idx',
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


class AIChatSession(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='ai_chat_sessions',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='ai_chat_sessions',
    )
    status = models.CharField(
        max_length=16,
        choices=AIChatSessionStatus.choices,
        default=AIChatSessionStatus.OPEN,
        db_index=True,
    )
    context_page = models.CharField(
        max_length=16,
        choices=AIChatContextPage.choices,
        blank=True,
        default='',
    )
    context_entity_id = models.UUIDField(null=True, blank=True)
    default_model_name = models.CharField(max_length=100, blank=True, default='')
    last_activity_at = models.DateTimeField(default=timezone.now, db_index=True)
    message_count = models.PositiveIntegerField(default=0)
    closed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'ai_chat_sessions'
        ordering = ('-last_activity_at', '-id')
        indexes = [
            models.Index(
                fields=('workspace', 'user', '-created_at'),
                name='ai_sess_ws_user_created_idx',
            ),
        ]

    @property
    def is_closed(self):
        return self.status == AIChatSessionStatus.CLOSED


class AIChatMessage(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        AIChatSession,
        on_delete=models.CASCADE,
        related_name='messages',
    )
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='ai_chat_messages',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='ai_chat_messages',
    )
    role = models.CharField(max_length=16, choices=AIChatRole.choices)
    content = models.TextField()
    status = models.CharField(
        max_length=16,
        choices=AIChatMessageStatus.choices,
        db_index=True,
    )
    parent_message = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='answer_attempts',
    )
    client_message_id = models.UUIDField(null=True, blank=True)
    retry_token = models.UUIDField(null=True, blank=True)
    model_name = models.CharField(max_length=100, blank=True, default='')
    provider = models.CharField(max_length=100, blank=True, default='')
    prompt_tokens = models.PositiveIntegerField(null=True, blank=True)
    completion_tokens = models.PositiveIntegerField(null=True, blank=True)
    total_tokens = models.PositiveIntegerField(null=True, blank=True)
    processing_time_ms = models.PositiveIntegerField(null=True, blank=True)
    error = models.TextField(blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'ai_chat_messages'
        ordering = ('created_at', 'id')
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'user', 'client_message_id'),
                condition=models.Q(client_message_id__isnull=False),
                name='unique_ai_chat_client_msg',
            ),
            models.UniqueConstraint(
                fields=('workspace', 'user', 'retry_token'),
                condition=models.Q(retry_token__isnull=False),
                name='unique_ai_chat_retry_token',
            ),
        ]
        indexes = [
            models.Index(
                fields=('session', '-created_at', '-id'),
                name='ai_msg_session_created_idx',
            ),
            models.Index(
                fields=('workspace', 'user', '-created_at', '-id'),
                name='ai_msg_ws_user_created_idx',
            ),
        ]
