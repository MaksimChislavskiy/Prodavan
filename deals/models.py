import uuid

from django.conf import settings
from django.db import models

from config.mixins import TimestampMixin


class DealEvent(models.TextChoices):
    CREATED = 'deal_created', 'Сделка создана'
    UPDATED = 'deal_updated', 'Сделка изменена'
    STAGE_CHANGED = 'deal_stage_changed', 'Этап сделки изменён'
    DELETED = 'deal_deleted', 'Сделка удалена'


class ChangedByType(models.TextChoices):
    USER = 'user', 'Пользователь'
    AI = 'ai', 'AI'
    SYSTEM = 'system', 'Система'


class SalesStage(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='sales_stages',
    )
    name = models.CharField(max_length=100)
    name_normalized = models.CharField(max_length=100, editable=False)
    is_system = models.BooleanField(default=False)
    order = models.PositiveSmallIntegerField()
    version = models.PositiveIntegerField(default=1)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'sales_stages'
        ordering = ('order', 'id')
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'name_normalized'),
                condition=models.Q(is_deleted=False),
                name='unique_active_stage_name_per_workspace',
            ),
            models.UniqueConstraint(
                fields=('workspace', 'order'),
                condition=models.Q(is_deleted=False),
                name='unique_active_stage_order_per_workspace',
            ),
            models.UniqueConstraint(
                fields=('workspace',),
                condition=models.Q(is_system=True, is_deleted=False),
                name='unique_system_stage_per_workspace',
            ),
        ]

    def save(self, *args, **kwargs):
        self.name = self.name.strip()
        self.name_normalized = self.name.casefold()
        return super().save(*args, **kwargs)


class Deal(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='deals',
    )
    stage = models.ForeignKey(
        SalesStage,
        on_delete=models.PROTECT,
        related_name='deals',
    )
    contact = models.ForeignKey(
        'contacts.Contact',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deals',
    )
    name = models.CharField(max_length=255)
    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        null=True,
        blank=True,
    )
    currency = models.CharField(max_length=3, default='RUB')
    comment = models.CharField(max_length=500, null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'deals'
        ordering = ('-updated_at', '-id')
        indexes = [
            models.Index(
                fields=('workspace', 'stage', '-updated_at', '-id'),
                name='deals_stage_sort_idx',
            ),
            models.Index(
                fields=('workspace', 'is_deleted'),
                name='deals_workspace_active_idx',
            ),
            models.Index(
                fields=('workspace', 'created_at'),
                name='deals_workspace_created_idx',
            ),
        ]


class DealHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='deal_history',
    )
    deal = models.ForeignKey(
        Deal,
        on_delete=models.CASCADE,
        related_name='history',
    )
    event_type = models.CharField(max_length=32, choices=DealEvent.choices)
    changed_by_type = models.CharField(
        max_length=16,
        choices=ChangedByType.choices,
        default=ChangedByType.USER,
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deal_history_entries',
    )
    changes = models.JSONField(default=dict, blank=True)
    reason = models.CharField(max_length=64, null=True, blank=True)
    correlation_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'deal_history'
        ordering = ('-created_at', '-id')
        indexes = [
            models.Index(
                fields=('deal', '-created_at'),
                name='deal_history_created_idx',
            ),
            models.Index(
                fields=('workspace', 'event_type', '-created_at'),
                name='deal_history_event_idx',
            ),
        ]


class DealIdempotencyRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='deal_idempotency_records',
    )
    operation = models.CharField(max_length=32)
    key = models.CharField(max_length=255)
    request_hash = models.CharField(max_length=64)
    response_body = models.JSONField()
    response_status = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        db_table = 'deal_idempotency_records'
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'operation', 'key'),
                name='unique_deal_idempotency_key',
            ),
        ]
