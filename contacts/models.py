import uuid

from django.conf import settings
from django.db import models

from config.mixins import TimestampMixin


class ContactAuditAction(models.TextChoices):
    CREATED = 'contact_created', 'Контакт создан'
    UPDATED = 'contact_updated', 'Контакт изменён'
    DELETED = 'contact_deleted', 'Контакт удалён'
    BULK_DELETED = 'contacts_bulk_deleted', 'Контакты удалены массово'


class Contact(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='contacts',
    )
    name = models.CharField(max_length=100)
    name_search = models.CharField(max_length=100, db_index=True, editable=False)
    company = models.CharField(max_length=100, null=True, blank=True)
    phone = models.CharField(max_length=16, null=True, blank=True)
    email = models.CharField(max_length=255, null=True, blank=True)
    telegram = models.CharField(max_length=33, null=True, blank=True)
    comment = models.TextField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    telegram_user_id = models.BigIntegerField(null=True, blank=True)
    telegram_chat_id = models.BigIntegerField(null=True, blank=True)
    telegram_username = models.CharField(max_length=32, null=True, blank=True)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'contacts'
        ordering = ('name', 'id')
        indexes = [
            models.Index(
                fields=('workspace', 'is_deleted'),
                name='contacts_workspace_active_idx',
            ),
            models.Index(
                fields=('workspace', 'phone'),
                name='contacts_workspace_phone_idx',
            ),
            models.Index(
                fields=('workspace', 'email'),
                name='contacts_workspace_email_idx',
            ),
            models.Index(
                fields=('workspace', 'telegram_user_id'),
                name='contacts_workspace_tg_user_idx',
            ),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.name_search = self.name.strip().casefold()
        update_fields = kwargs.get('update_fields')
        if update_fields is not None and 'name' in update_fields:
            kwargs['update_fields'] = tuple(
                dict.fromkeys((*update_fields, 'name_search')),
            )
        return super().save(*args, **kwargs)


class ContactAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='contact_audit_logs',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='contact_audit_logs',
    )
    action = models.CharField(max_length=32, choices=ContactAuditAction.choices)
    contact_identifier = models.UUIDField(null=True, blank=True, db_index=True)
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default='')
    correlation_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'contact_audit_log'
        ordering = ('-created_at',)
