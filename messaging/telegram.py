import json
import re
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from contacts.models import Contact, ContactAuditAction, ContactAuditLog
from contacts.serializers import normalize_email, normalize_phone
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
EMAIL_CANDIDATE_PATTERN = re.compile(
    r'(?<![\w.+-])([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})(?![\w-])',
    re.IGNORECASE,
)
PHONE_CANDIDATE_PATTERN = re.compile(
    r'(?<!\d)(\+?\d[\d\s().-]{5,}\d)(?!\d)',
)


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


def _message_contact_identifiers(text):
    email = None
    email_match = EMAIL_CANDIDATE_PATTERN.search(text or '')
    if email_match is not None:
        try:
            email = normalize_email(email_match.group(1))
        except ValidationError:
            email = None

    phone = None
    for match in PHONE_CANDIDATE_PATTERN.finditer(text or ''):
        candidate = match.group(1).strip()
        digits = re.sub(r'\D', '', candidate)
        if not (
            candidate.startswith('+')
            or len(digits) == 10
            or (len(digits) == 11 and digits.startswith(('7', '8')))
        ):
            continue
        try:
            phone = normalize_phone(candidate)
        except ValidationError:
            continue
        break
    return phone, email


def _find_contact(workspace, telegram_user_id, username, *, phone, email):
    queryset = Contact.objects.select_for_update().filter(
        workspace=workspace,
        is_deleted=False,
    )
    contact = queryset.filter(telegram_user_id=telegram_user_id).first()
    if contact is not None:
        return contact, 'telegram_user_id'
    if username:
        contact = queryset.filter(
            Q(telegram_username__iexact=username)
            | Q(telegram__iexact=f'@{username}'),
        ).order_by('created_at', 'id').first()
        if contact is not None:
            return contact, 'telegram_username'
    if phone:
        contact = (
            queryset.filter(phone=phone)
            .order_by('created_at', 'id')
            .first()
        )
        if contact is not None:
            return contact, 'phone'
    if email:
        contact = queryset.filter(
            email__iexact=email,
        ).order_by('created_at', 'id').first()
        if contact is not None:
            return contact, 'email'
    return None, None


def _notify_possible_duplicate(workspace, contact):
    create_workspace_notification(
        workspace=workspace,
        type=NotificationType.CONTACT_AI_UPDATED,
        title='Обнаружен существующий контакт',
        content=(
            'Обнаружен существующий контакт. '
            'Возможно, требуется объединение данных.'
        ),
        link='/app/contacts',
        entity_type='contact',
        entity_id=str(contact.id),
    )


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
        text = _message_text(message)
        phone, email = _message_contact_identifiers(text)
        contact, match_reason = _find_contact(
            webhook_log.workspace,
            telegram_user_id,
            username,
            phone=phone,
            email=email,
        )
        contact_created = contact is None
        duplicate_contact_detected = match_reason in {'phone', 'email'}
        if contact_created:
            contact = create_contact(
                workspace=webhook_log.workspace,
                user=None,
                source='ai',
                data={
                    'name': _contact_name(sender)[:100],
                    'phone': phone,
                    'email': email,
                    'telegram': f'@{username}' if username else None,
                    'comment': 'Создан AI из чата',
                    'telegram_user_id': telegram_user_id,
                    'telegram_chat_id': telegram_chat_id,
                    'telegram_username': username,
                },
                audit_changes={
                    'trigger': 'first_message',
                    'channel': 'telegram',
                },
            )
        elif duplicate_contact_detected:
            # ТЗ 8.4: совпадение по активному phone/e-mail не создаёт новый
            # контакт и не изменяет CRM-данные существующего. Технические Telegram
            # идентификаторы сохраняем только для устойчивой маршрутизации следующих
            # сообщений этого же диалога; version и пользовательские поля не меняются.
            Contact.objects.filter(id=contact.id).update(
                telegram_user_id=telegram_user_id,
                telegram_chat_id=telegram_chat_id,
            )
            _notify_possible_duplicate(webhook_log.workspace, contact)
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

        telegram_message_id = message.get('message_id')
        if isinstance(telegram_message_id, bool) or not isinstance(
            telegram_message_id,
            int,
        ):
            telegram_message_id = None
        incoming = Message.objects.create(
            chat=chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=contact.id,
            text=text,
            status=None,
            read_at=None,
            source_update_id=webhook_log.update_id,
            telegram_message_id=telegram_message_id,
        )

        if contact_created or duplicate_contact_detected:
            from ai_assistant.models import AIAutomationEvent, AutomationEventStatus

            automation_event = AIAutomationEvent.objects.filter(
                message=incoming,
            ).first()
            if automation_event is not None and contact_created:
                automation_event.contact_created = True
                automation_event.save(
                    update_fields=('contact_created', 'updated_at'),
                )
                ContactAuditLog.objects.filter(
                    workspace=webhook_log.workspace,
                    contact_identifier=contact.id,
                    action=ContactAuditAction.CREATED,
                ).update(correlation_id=automation_event.id)
            elif automation_event is not None and duplicate_contact_detected:
                # Не запускаем AI-enrichment на том же первом сообщении: иначе
                # найденный дубль мог бы быть изменён сразу после предупреждения.
                automation_event.status = AutomationEventStatus.IGNORED
                automation_event.processed_at = timezone.now()
                automation_event.locked_at = None
                automation_event.last_error = 'Possible duplicate contact requires review.'
                automation_event.analysis = {'contact_duplicate_detected': True}
                automation_event.save(update_fields=(
                    'status',
                    'processed_at',
                    'locked_at',
                    'last_error',
                    'analysis',
                    'updated_at',
                ))

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
            action=ChatAuditAction.TELEGRAM_MESSAGE_RECEIVED,
            chat_id=chat.id,
            message_id=incoming.id,
            details={
                'update_id': webhook_log.update_id,
                'telegram_message_id': telegram_message_id,
                'telegram_chat_id': telegram_chat_id,
                'telegram_user_id': telegram_user_id,
            },
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
            # События отправляются по порядку: сначала пустой новый чат, затем
            # message_new. Если передать здесь уже обновлённый unread_count=1,
            # клиент корректно прибавит входящее message_new ещё раз и получит 2.
            # Контракт 12.10 задаёт для chat_created исходное состояние 0/null.
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
                    'last_message': None,
                    'last_message_at': None,
                    'unread_count': 0,
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
