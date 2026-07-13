import uuid

from django.conf import settings
from django.db import models

from config.mixins import TimestampMixin


class NotificationType(models.TextChoices):
    DEAL_CREATED = 'deal_created', 'Новая сделка'
    DEAL_UPDATED = 'deal_updated', 'Изменение сделки'
    DEAL_ATTENTION = 'deal_attention', 'Сделка требует внимания'
    CONTACT_AI_CREATED = 'ai_contact_created', 'AI создал контакт'
    CONTACT_AI_UPDATED = 'ai_contact_updated', 'AI обновил контакт'
    AI_DEAL_UPDATED = 'ai_deal_updated', 'AI обновил сделку'
    TASK_DUE_SOON = 'task_due_soon', 'Приближается срок задачи'
    TASK_OVERDUE = 'task_overdue', 'Задача просрочена'
    CHAT_NEW_MESSAGE = 'chat_new_message', 'Новое сообщение клиента'
    CHAT_RETURNED = 'chat_returned', 'Клиент вернулся'
    CHAT_MISSED_MESSAGE = 'chat_missed_message', 'Пропущено сообщение клиента'
    AI_DEAL_CREATED = 'ai_deal_created', 'AI создал сделку'
    AI_TASK_CREATED = 'ai_task_created', 'AI создал задачу'
    AI_INSIGHT_EXTRACTED = 'ai_insight_extracted', 'AI нашёл важную информацию'
    AI_AUTOPILOT_SENT = 'ai_autopilot_sent', 'Автопилот отправил ответ'
    AI_LIMIT_REACHED = 'ai_limit_reached', 'AI достиг лимита'
    AI_ACTION_FAILED = 'ai_action_failed', 'Ошибка AI-действия'


class Notification(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    type = models.CharField(
        max_length=64,
        choices=NotificationType.choices,
        db_index=True,
    )
    title = models.CharField(max_length=60)
    content = models.CharField(max_length=255)
    link = models.CharField(max_length=500, blank=True, default='')
    entity_type = models.CharField(max_length=50, blank=True, default='')
    entity_id = models.CharField(max_length=36, blank=True, default='')
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'notifications'
        ordering = ('-created_at', '-id')
        indexes = [
            models.Index(
                fields=('user', 'is_deleted', 'is_read'),
                name='notif_user_read_idx',
            ),
            models.Index(
                fields=('user', 'is_deleted', '-created_at', '-id'),
                name='notif_user_created_idx',
            ),
            models.Index(
                fields=('workspace', 'type', '-created_at'),
                name='notif_ws_type_created_idx',
            ),
        ]

    def __str__(self):
        return self.title
