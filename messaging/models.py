import uuid

from django.conf import settings
from django.db import models

from config.mixins import TimestampMixin


class MessageSenderType(models.TextChoices):
    USER = 'user', 'Пользователь CRM'
    CONTACT = 'contact', 'Контакт'


class MessageStatus(models.TextChoices):
    SENT = 'sent', 'Отправлено'
    DELIVERED = 'delivered', 'Доставлено'
    FAILED = 'failed', 'Ошибка'


class ChatAuditAction(models.TextChoices):
    CHAT_CREATED = 'chat_created', 'Чат создан'
    MESSAGE_SENT = 'message_sent', 'Сообщение отправлено'
    TELEGRAM_MESSAGE_SENT = (
        'telegram_message_sent',
        'Telegram-сообщение отправлено',
    )
    MESSAGE_RECEIVED = 'message_received', 'Сообщение получено'
    TELEGRAM_MESSAGE_RECEIVED = (
        'telegram_message_received',
        'Telegram-сообщение получено',
    )
    MESSAGE_READ = 'message_read', 'Сообщения прочитаны'
    CHAT_DELETED = 'chat_deleted', 'Чат удалён'


class Chat(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='chats',
    )
    contact = models.ForeignKey(
        'contacts.Contact',
        on_delete=models.RESTRICT,
        related_name='chats',
    )
    last_message = models.TextField(null=True, blank=True)
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    unread_count = models.PositiveIntegerField(default=0)
    ai_autopilot_enabled = models.BooleanField(null=True, blank=True, default=None)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'chats'
        ordering = ('-last_message_at', '-id')
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'contact'),
                condition=models.Q(is_deleted=False),
                name='unique_active_chat_per_contact',
            ),
        ]
        indexes = [
            models.Index(
                fields=('workspace', 'is_deleted', '-last_message_at', '-id'),
                name='chats_workspace_recent_idx',
            ),
            models.Index(fields=('contact',), name='chats_contact_idx'),
        ]

    def __str__(self):
        return f'{self.contact.name}: {self.id}'


class Message(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey(
        Chat,
        on_delete=models.CASCADE,
        related_name='messages',
    )
    sender_type = models.CharField(max_length=16, choices=MessageSenderType.choices)
    sender_id = models.UUIDField(db_index=True)
    text = models.TextField()
    status = models.CharField(
        max_length=16,
        choices=MessageStatus.choices,
        null=True,
        blank=True,
    )
    read_at = models.DateTimeField(null=True, blank=True, db_index=True)
    sent_by_ai = models.BooleanField(default=False)
    source_update_id = models.BigIntegerField(null=True, blank=True)
    telegram_message_id = models.BigIntegerField(null=True, blank=True)
    delivery_attempts = models.PositiveSmallIntegerField(default=0)
    next_delivery_attempt_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
    )
    delivered_at = models.DateTimeField(null=True, blank=True)
    last_delivery_error = models.TextField(blank=True, default='')
    is_deleted = models.BooleanField(default=False, db_index=True)

    class Meta:
        db_table = 'messages'
        ordering = ('created_at', 'id')
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(sender_type=MessageSenderType.CONTACT, status__isnull=True)
                    | models.Q(sender_type=MessageSenderType.USER, status__isnull=False)
                ),
                name='message_status_matches_sender',
            ),
            models.UniqueConstraint(
                fields=('chat', 'source_update_id'),
                condition=models.Q(source_update_id__isnull=False),
                name='unique_telegram_update_per_chat',
            ),
        ]
        indexes = [
            models.Index(
                fields=('chat', '-created_at', '-id'),
                name='messages_chat_recent_idx',
            ),
            models.Index(
                fields=('chat', 'read_at'),
                name='messages_chat_read_idx',
            ),
        ]


class MessageIdempotencyRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='message_idempotency_records',
    )
    chat = models.ForeignKey(
        Chat,
        on_delete=models.CASCADE,
        related_name='idempotency_records',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='message_idempotency_records',
    )
    key = models.CharField(max_length=255)
    request_hash = models.CharField(max_length=64)
    message = models.OneToOneField(
        Message,
        on_delete=models.CASCADE,
        related_name='idempotency_record',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        db_table = 'message_idempotency_records'
        constraints = [
            models.UniqueConstraint(
                fields=('workspace', 'key'),
                name='unique_message_idempotency_key',
            ),
        ]


class ChatAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='chat_audit_logs',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='chat_audit_logs',
    )
    action = models.CharField(max_length=32, choices=ChatAuditAction.choices)
    chat_identifier = models.UUIDField(null=True, blank=True, db_index=True)
    message_identifier = models.UUIDField(null=True, blank=True, db_index=True)
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default='')
    correlation_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'chat_audit_log'
        ordering = ('-created_at',)
