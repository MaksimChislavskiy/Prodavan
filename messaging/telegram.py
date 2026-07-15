import json
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from contacts.models import Contact
from contacts.services import create_contact
from notifications.models import NotificationType
from notifications.services import create_workspace_notification
from workspaces.models import TelegramWebhookLog, WorkspaceAuditLog

from .models import Chat, ChatAuditAction, Message, MessageSenderType
from .realtime import broadcast_workspace_event
from .serializers import MessageSerializer
from .services import write_chat_audit


MEDIA_LABELS = (
    ('photo', '[Фото]'),
    ('document', '[Документ]'),
    ('video', '[Видео]'),
    ('audio', '[Аудио]'),
    ('voice', '[Голосовое сообщение]'),
    ('sticker', '[Стикер]'),
    ('animation', '[Анимация]'),
)
MAX_WEBHOOK_PROCESSING_ATTEMPTS = 3


def _incoming_notification_text(contact, text):
    preview = ' '.join((text or '').split())
    if len(preview) > 160:
        preview = f'{preview[:157]}...'
    return f'{contact.name}: {preview}' if preview else f'{contact.name}: новое сообщение'


def _returned_notification_text(contact, text):
    preview = _incoming_notification_text(contact, text)
    return f'{preview} Клиент снова вышел на связь.'


def _client_returned(*, previous_message_at, now):
    if previous_message_at is None:
        return False
    threshold = timedelta(days=settings.CHAT_RETURNED_AFTER_DAYS)
    return now - previous_message_at >= threshold


def _message_text(message):
    text = (message.get('text') or '').strip()
    if text:
        return text[:4096]
    caption = (message.get('caption') or '').strip()
    for field, label in MEDIA_LABELS:
        if field in message:
            return f'{label} {caption}'.strip()[:4096]
    return caption[:4096] if caption else '[Неподдерживаемое сообщение]'


def _contact_name(sender):
    full_name = ' '.join(
        value.strip()
        for value in (sender.get('first_name', ''), sender.get('last_name', ''))
        if isinstance(value, str) and value.strip()
    )
    return full_name or sender.get('username') or 'Неизвестный контакт'


def _find_contact(workspace, telegram_user_id, username):
    queryset = Contact.objects.filter(workspace=workspace)
    contact = queryset.filter(telegram_user_id=telegram_user_id).first()
    if contact is not None or not username:
        return contact
    return queryset.filter(
        Q(telegram_username__iexact=username)
        | Q(telegram__iexact=f'@{username}'),
    ).order_by('created_at', 'id').first()


def process_telegram_webhook_log(log_id):
    with transaction.atomic():
        webhook_log = (
            TelegramWebhookLog.objects.select_for_update()
            .select_related('workspace')
            .filter(id=log_id, failed_at__isnull=True)
            .first()
        )
        if webhook_log is None or webhook_log.processed:
            return False

        webhook_log.processing_attempts += 1
        webhook_log.save(update_fields=('processing_attempts',))

        payload = webhook_log.payload
        message = payload.get('message') if isinstance(payload, dict) else None
        if not isinstance(message, dict):
            webhook_log.processed = True
            webhook_log.processing_error = ''
            webhook_log.save(
                update_fields=('processed', 'processing_error'),
            )
            return True

        sender = message.get('from') or {}
        telegram_chat = message.get('chat') or {}
        telegram_user_id = sender.get('id')
        telegram_chat_id = telegram_chat.get('id')
        if (
            sender.get('is_bot')
            or isinstance(telegram_user_id, bool)
            or not isinstance(telegram_user_id, int)
            or isinstance(telegram_chat_id, bool)
            or not isinstance(telegram_chat_id, int)
        ):
            webhook_log.processed = True
            webhook_log.processing_error = ''
            webhook_log.save(
                update_fields=('processed', 'processing_error'),
            )
            return True

        username = sender.get('username')
        if not isinstance(username, str):
            username = None
        contact = _find_contact(
            webhook_log.workspace,
            telegram_user_id,
            username,
        )
        if contact is None:
            contact = create_contact(
                workspace=webhook_log.workspace,
                user=None,
                source='telegram',
                data={
                    'name': _contact_name(sender)[:100],
                    'telegram': f'@{username}' if username else None,
                    'telegram_user_id': telegram_user_id,
                    'telegram_chat_id': telegram_chat_id,
                    'telegram_username': username,
                },
            )
        else:
            Contact.objects.filter(id=contact.id).update(
                telegram_user_id=telegram_user_id,
                telegram_chat_id=telegram_chat_id,
                telegram_username=username,
                telegram=contact.telegram or (f'@{username}' if username else None),
                updated_at=timezone.now(),
            )
            contact.refresh_from_db()

        chat = Chat.objects.filter(
            workspace=webhook_log.workspace,
            contact=contact,
            is_deleted=False,
        ).first()
        chat_created = chat is None
        if chat_created:
            chat = Chat.objects.create(
                workspace=webhook_log.workspace,
                contact=contact,
            )
            write_chat_audit(
                workspace=webhook_log.workspace,
                action=ChatAuditAction.CHAT_CREATED,
                chat_id=chat.id,
                details={'contact_id': str(contact.id), 'source': 'telegram'},
            )
        previous_message_at = chat.last_message_at

        text = _message_text(message)
        incoming = Message.objects.create(
            chat=chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=contact.id,
            text=text,
            status=None,
            read_at=None,
            source_update_id=webhook_log.update_id,
        )
        now = incoming.created_at
        Chat.objects.filter(id=chat.id).update(
            last_message=text,
            last_message_at=now,
            unread_count=F('unread_count') + 1,
            updated_at=now,
        )
        chat.refresh_from_db()
        webhook_log.processed = True
        webhook_log.processing_error = ''
        webhook_log.save(update_fields=('processed', 'processing_error'))
        write_chat_audit(
            workspace=webhook_log.workspace,
            action=ChatAuditAction.MESSAGE_RECEIVED,
            chat_id=chat.id,
            message_id=incoming.id,
            details={'update_id': webhook_log.update_id},
        )
        client_returned = not chat_created and _client_returned(
            previous_message_at=previous_message_at,
            now=now,
        )
        notification_type = (
            NotificationType.CHAT_RETURNED
            if client_returned
            else NotificationType.CHAT_NEW_MESSAGE
        )
        create_workspace_notification(
            workspace=webhook_log.workspace,
            type=notification_type,
            title=(
                'Клиент вернулся'
                if client_returned
                else 'Новое сообщение клиента'
            ),
            content=(
                _returned_notification_text(contact, text)
                if client_returned
                else _incoming_notification_text(contact, text)
            ),
            link=f'/chat/{chat.id}',
            entity_type='chat',
            entity_id=str(chat.id),
            now=now,
        )
        if chat_created:
            chat_payload = {
                'event': 'chat_created',
                'chat': {
                    'id': str(chat.id),
                    'contact': {
                        'id': str(contact.id),
                        'name': contact.name,
                        'company': contact.company,
                        'is_deleted': contact.is_deleted,
                    },
                    'last_message': chat.last_message,
                    'last_message_at': chat.last_message_at.isoformat(),
                    'unread_count': chat.unread_count,
                },
            }
            transaction.on_commit(
                lambda: broadcast_workspace_event(
                    webhook_log.workspace_id,
                    chat_payload,
                ),
            )
        message_payload = {
            'event': 'message_new',
            'chat_id': str(chat.id),
            'message': dict(MessageSerializer(incoming).data),
        }
        transaction.on_commit(
            lambda: broadcast_workspace_event(
                webhook_log.workspace_id,
                message_payload,
            ),
        )
    return True


def _record_webhook_failure(log_id, error):
    with transaction.atomic():
        webhook_log = (
            TelegramWebhookLog.objects.select_for_update()
            .select_related('workspace')
            .filter(id=log_id, processed=False, failed_at__isnull=True)
            .first()
        )
        if webhook_log is None:
            return False

        webhook_log.processing_attempts += 1
        is_final = (
            webhook_log.processing_attempts >= MAX_WEBHOOK_PROCESSING_ATTEMPTS
        )
        webhook_log.processing_error = (
            f'{type(error).__name__}: {error}'[:2000]
        )
        if is_final:
            webhook_log.failed_at = timezone.now()
        webhook_log.save(update_fields=(
            'processing_attempts',
            'processing_error',
            'failed_at',
        ))
        _write_webhook_failure_audit(
            webhook_log,
            error_type=type(error).__name__,
            is_final=is_final,
        )
        return is_final


def _write_webhook_failure_audit(webhook_log, *, error_type, is_final):
    system_user = (
        webhook_log.workspace.users.filter(
            role='admin',
            is_active=True,
            is_deleted=False,
        )
        .order_by('created_at', 'id')
        .first()
        or webhook_log.workspace.users.filter(
            is_active=True,
            is_deleted=False,
        ).order_by('created_at', 'id').first()
        or webhook_log.workspace.users.order_by('created_at', 'id').first()
    )
    if system_user is None:
        return
    details = json.dumps(
        {
            'update_id': webhook_log.update_id,
            'attempt': webhook_log.processing_attempts,
            'error_type': error_type,
            'final': is_final,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    )
    WorkspaceAuditLog.objects.create(
        user=system_user,
        workspace=webhook_log.workspace,
        user_identifier=system_user.id,
        workspace_identifier=webhook_log.workspace_id,
        field='telegram_webhook_failed',
        old_value=None,
        new_value=details,
        request_id=uuid.uuid4(),
    )


def process_pending_telegram_webhooks(*, limit=100):
    log_ids = list(
        TelegramWebhookLog.objects.filter(
            processed=False,
            failed_at__isnull=True,
            processing_attempts__lt=MAX_WEBHOOK_PROCESSING_ATTEMPTS,
        )
        .order_by('received_at', 'id')
        .values_list('id', flat=True)[:limit],
    )
    processed = 0
    failed = 0
    permanently_failed = 0
    for log_id in log_ids:
        try:
            if process_telegram_webhook_log(log_id):
                processed += 1
        except Exception as error:
            failed += 1
            if _record_webhook_failure(log_id, error):
                permanently_failed += 1
    return {
        'processed': processed,
        'failed': failed,
        'permanently_failed': permanently_failed,
    }
