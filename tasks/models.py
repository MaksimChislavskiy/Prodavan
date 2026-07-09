import uuid

from django.conf import settings
from django.db import models

from config.mixins import TimestampMixin


class TaskStatus(models.TextChoices):
    NEW = 'new', 'Новая'
    IN_PROGRESS = 'in_progress', 'В работе'
    DONE = 'done', 'Выполнена'


class DueDateType(models.TextChoices):
    DATETIME = 'datetime', 'Дата и время'
    DATE = 'date', 'Дата'
    NONE = 'none', 'Без срока'


class TaskEvent(models.TextChoices):
    CREATED = 'task_created', 'Задача создана'
    UPDATED = 'task_updated', 'Задача изменена'
    DELETED = 'task_deleted', 'Задача удалена'
    BULK_DELETED = 'tasks_bulk_deleted', 'Задачи удалены массово'


class TaskSource(models.TextChoices):
    USER = 'user', 'Пользователь'
    AI = 'ai', 'AI'
    SYSTEM = 'system', 'Система'


class Task(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='tasks',
    )
    title = models.CharField(max_length=255)
    description = models.TextField(max_length=1000, null=True, blank=True)
    due_date = models.DateTimeField(null=True, blank=True)
    due_date_type = models.CharField(
        max_length=16,
        choices=DueDateType.choices,
        default=DueDateType.NONE,
    )
    status = models.CharField(
        max_length=16,
        choices=TaskStatus.choices,
        default=TaskStatus.NEW,
    )
    contact = models.ForeignKey(
        'contacts.Contact',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tasks',
    )
    deal = models.ForeignKey(
        'deals.Deal',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tasks',
    )
    comment = models.TextField(max_length=500, null=True, blank=True)
    created_by_ai = models.BooleanField(default=False)
    created_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_tasks',
    )
    version = models.PositiveIntegerField(default=1)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'tasks'
        ordering = ('due_date', '-created_at', '-id')
        indexes = [
            models.Index(
                fields=(
                    'workspace', 'status', 'is_deleted', 'due_date',
                    '-created_at', '-id',
                ),
                name='tasks_kanban_idx',
            ),
            models.Index(fields=('contact',), name='tasks_contact_idx'),
            models.Index(fields=('deal',), name='tasks_deal_idx'),
            models.Index(
                fields=('workspace', 'created_at'),
                name='tasks_workspace_created_idx',
            ),
        ]


class TaskHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='task_history',
    )
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name='history',
    )
    event = models.CharField(max_length=32, choices=TaskEvent.choices)
    source = models.CharField(
        max_length=16,
        choices=TaskSource.choices,
        default=TaskSource.USER,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='task_history_entries',
    )
    data = models.JSONField(default=dict, blank=True)
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default='')
    correlation_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'task_history'
        ordering = ('-created_at', '-id')
        indexes = [
            models.Index(
                fields=('task', '-created_at'),
                name='task_history_created_idx',
            ),
        ]


class TaskAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='task_audit_logs',
    )
    task_identifier = models.UUIDField(null=True, blank=True, db_index=True)
    event = models.CharField(max_length=32, choices=TaskEvent.choices)
    source = models.CharField(max_length=16, choices=TaskSource.choices)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='task_audit_logs',
    )
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default='')
    correlation_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'task_audit_log'
        ordering = ('-created_at', '-id')


class TaskIdempotencyRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='task_idempotency_records',
    )
    key = models.CharField(max_length=255)
    request_hash = models.CharField(max_length=64)
    response_body = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        db_table = 'task_idempotency_records'
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'key'),
                name='unique_task_idempotency_key',
            ),
        ]
