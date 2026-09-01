from pathlib import PurePath

from django.db.models.signals import post_save
from django.dispatch import receiver

from workspaces.models import TelegramWebhookLog

from .models import Message, MessageAttachmentType, MessageSenderType


def _safe_filename(value, fallback):
    raw = str(value or '').replace('\\', '/')
    name = PurePath(raw).name.strip()
    return (name or fallback)[:255]


def _positive_int(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _incoming_attachment_descriptor(payload):
    if not isinstance(payload, dict):
        return None
    message = payload.get('message') or payload.get('edited_message')
    if not isinstance(message, dict):
        return None

    message_id = message.get('message_id')
    photo_items = message.get('photo')
    if isinstance(photo_items, list):
        candidates = [
            item
            for item in photo_items
            if isinstance(item, dict)
            and isinstance(item.get('file_id'), str)
            and item['file_id']
        ]
        if candidates:
            best = max(
                candidates,
                key=lambda item: (
                    _positive_int(item.get('file_size')) or 0,
                    (_positive_int(item.get('width')) or 0)
                    * (_positive_int(item.get('height')) or 0),
                ),
            )
            return {
                'file_id': best['file_id'],
                'type': MessageAttachmentType.IMAGE,
                'name': f'photo_{message_id or "telegram"}.jpg',
                'size': _positive_int(best.get('file_size')),
                'mime_type': 'image/jpeg',
            }

    document = message.get('document')
    if isinstance(document, dict):
        file_id = document.get('file_id')
        if isinstance(file_id, str) and file_id:
            mime_type = document.get('mime_type')
            if not isinstance(mime_type, str) or not mime_type.strip():
                mime_type = 'application/octet-stream'
            mime_type = mime_type.strip()[:255]
            return {
                'file_id': file_id,
                'type': (
                    MessageAttachmentType.IMAGE
                    if mime_type.lower().startswith('image/')
                    else MessageAttachmentType.DOCUMENT
                ),
                'name': _safe_filename(
                    document.get('file_name'),
                    f'document_{message_id or "telegram"}',
                ),
                'size': _positive_int(document.get('file_size')),
                'mime_type': mime_type,
            }

    return None


@receiver(
    post_save,
    sender=Message,
    dispatch_uid='messaging.ingest_telegram_attachment',
)
def ingest_telegram_attachment(sender, instance, created, **kwargs):
    if (
        not created
        or instance.sender_type != MessageSenderType.CONTACT
        or instance.source_update_id is None
        or instance.attachment_type is not None
    ):
        return

    webhook_log = TelegramWebhookLog.objects.filter(
        workspace_id=instance.chat.workspace_id,
        update_id=instance.source_update_id,
    ).only('payload').first()
    if webhook_log is None:
        return

    descriptor = _incoming_attachment_descriptor(webhook_log.payload)
    if descriptor is None:
        return

    instance.attachment_type = descriptor['type']
    instance.attachment_name = descriptor['name']
    instance.attachment_size = descriptor['size']
    instance.attachment_mime_type = descriptor['mime_type']
    instance.attachment_external_id = descriptor['file_id']
    instance.save(update_fields=(
        'attachment_type',
        'attachment_name',
        'attachment_size',
        'attachment_mime_type',
        'attachment_external_id',
        'updated_at',
    ))
