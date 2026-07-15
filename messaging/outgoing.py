import hashlib
import json
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from notifications.delivery_failures import (
    create_delivery_failure_notifications,
)
from workspaces.crypto import IntegrationSecretError, decrypt_integration_secret
from workspaces.models import IntegrationStatus, IntegrationType, WorkspaceIntegration
from workspaces.telegram import (
    TelegramApiUnavailable,
    TelegramBotApiClient,
    TelegramInvalidToken,
    TelegramMessageRejected,
)

from .models import (
    Chat,
    ChatAuditAction,
    Message,
    MessageIdempotencyRecord,
    MessageSenderType,
    MessageStatus,
)
from .realtime import broadcast_workspace_event
from .serializers import MessageSerializer
from .services import ChatServiceError, write_chat_audit


IDEMPOTENCY_TTL = timedelta(hours=24)
RETRY_DELAY = timedelta(minutes=5)
MAX_DELIVERY_ATTEMPTS = 3


class PermanentDeliveryError(Exception):
    pass


def _request_hash(chat_id, text):
    payload = json.dumps(
        {'chat_id': str(chat_id), 'text': text},
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    ).encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def enqueue_outgoing_message(
    *,
    workspace,
    user,
    chat_id,
    text,
    idempotency_key,
    audit_context=None,
):
    if not idempotency_key:
        raise ChatServiceError(
            'missing_idempotency_key',
            'Idempotency-Key header is required',
        )
    if len(idempotency_key) > 255:
        raise ChatServiceError(
            'invalid_idempotency_key',
            'Idempotency-Key must not exceed 255 characters',
        )
    now = timezone.now()
    request_hash = _request_hash(chat_id, text)
    with transaction.atomic():
        chat = Chat.objects.select_for_update().select_related('contact').filter(
            id=chat_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if chat is None:
            raise ChatServiceError(
                'CHAT_NOT_FOUND',
                'Чат не найден.',
                status_code=404,
            )
        record = (
            MessageIdempotencyRecord.objects.select_for_update()
            .select_related('message')
            .filter(workspace=workspace, key=idempotency_key)
            .first()
        )
        if record is not None and record.expires_at <= now:
            record.delete()
            record = None
        if record is not None:
            if record.request_hash != request_hash:
                raise ChatServiceError(
                    'idempotency_conflict',
                    'Idempotency-Key already used with different payload',
                    status_code=409,
                )
            return record.message, True

        integration_exists = WorkspaceIntegration.objects.filter(
            workspace=workspace,
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
        ).exclude(config={}).exists()
        if not integration_exists:
            raise ChatServiceError(
                'TELEGRAM_NOT_CONNECTED',
                'Telegram-интеграция не подключена.',
                status_code=409,
            )
        if chat.contact.telegram_chat_id is None:
            raise ChatServiceError(
                'TELEGRAM_CHAT_NOT_AVAILABLE',
                'Для контакта отсутствует Telegram chat_id.',
                status_code=409,
            )

        message = Message.objects.create(
            chat=chat,
            sender_type=MessageSenderType.USER,
            sender_id=user.id,
            text=text,
            status=MessageStatus.SENT,
            next_delivery_attempt_at=now,
        )
        MessageIdempotencyRecord.objects.create(
            workspace=workspace,
            chat=chat,
            user=user,
            key=idempotency_key,
            request_hash=request_hash,
            message=message,
            expires_at=now + IDEMPOTENCY_TTL,
        )
        chat.last_message = text
        chat.last_message_at = message.created_at
        chat.save(
            update_fields=('last_message', 'last_message_at', 'updated_at'),
        )
        write_chat_audit(
            workspace=workspace,
            user=user,
            action=ChatAuditAction.MESSAGE_SENT,
            chat_id=chat.id,
            message_id=message.id,
            details={'status': MessageStatus.SENT, 'sent_by_ai': False},
            context=audit_context,
        )
        payload = {
            'event': 'message_new',
            'chat_id': str(chat.id),
            'message': dict(MessageSerializer(message).data),
        }
        transaction.on_commit(
            lambda: broadcast_workspace_event(workspace.id, payload),
        )
    return message, False


def _delivery_credentials(message):
    integration = WorkspaceIntegration.objects.filter(
        workspace=message.chat.workspace,
        type=IntegrationType.TELEGRAM,
        status=IntegrationStatus.CONNECTED,
    ).first()
    if integration is None or not integration.config:
        raise PermanentDeliveryError('Telegram-интеграция отключена.')
    if message.chat.contact.telegram_chat_id is None:
        raise PermanentDeliveryError('У контакта отсутствует Telegram chat_id.')
    try:
        token = decrypt_integration_secret(
            envelope=integration.config,
            workspace_id=message.chat.workspace_id,
            integration_type=IntegrationType.TELEGRAM,
        )
    except IntegrationSecretError as error:
        raise PermanentDeliveryError(
            'Не удалось расшифровать Telegram-токен.',
        ) from error
    return token, message.chat.contact.telegram_chat_id


def process_outgoing_message(message_id, *, client=None, now=None):
    client = client or TelegramBotApiClient()
    now = now or timezone.now()
    with transaction.atomic():
        message = (
            Message.objects.select_for_update()
            .select_related('chat__workspace', 'chat__contact')
            .filter(id=message_id, is_deleted=False)
            .first()
        )
        if (
            message is None
            or message.status != MessageStatus.SENT
            or message.sender_type != MessageSenderType.USER
            or (
                message.next_delivery_attempt_at is not None
                and message.next_delivery_attempt_at > now
            )
        ):
            return False

        message.delivery_attempts += 1
        permanent_failure = False
        try:
            token, telegram_chat_id = _delivery_credentials(message)
            result = client.send_message(
                token,
                chat_id=telegram_chat_id,
                text=message.text,
            )
        except (
            PermanentDeliveryError,
            TelegramInvalidToken,
            TelegramMessageRejected,
        ) as error:
            permanent_failure = True
            delivery_error = str(error)
        except TelegramApiUnavailable as error:
            delivery_error = str(error)
        else:
            message.status = MessageStatus.DELIVERED
            message.telegram_message_id = result['message_id']
            message.delivered_at = now
            message.next_delivery_attempt_at = None
            message.last_delivery_error = ''
            message.save(
                update_fields=(
                    'status', 'telegram_message_id', 'delivered_at',
                    'delivery_attempts', 'next_delivery_attempt_at',
                    'last_delivery_error', 'updated_at',
                ),
            )
            audit_user = None
            if not message.sent_by_ai:
                audit_user = message.chat.workspace.users.filter(
                    id=message.sender_id,
                ).first()
            write_chat_audit(
                workspace=message.chat.workspace,
                user=audit_user,
                action=ChatAuditAction.TELEGRAM_MESSAGE_SENT,
                chat_id=message.chat_id,
                message_id=message.id,
                details={
                    'status': MessageStatus.DELIVERED,
                    'sent_by_ai': message.sent_by_ai,
                    'telegram_message_id': message.telegram_message_id,
                    'delivery_attempts': message.delivery_attempts,
                },
            )
            payload = {
                'event': 'message_status_updated',
                'chat_id': str(message.chat_id),
                'message_id': str(message.id),
                'status': MessageStatus.DELIVERED,
            }
            transaction.on_commit(
                lambda: broadcast_workspace_event(
                    message.chat.workspace_id,
                    payload,
                ),
            )
            return True

        message.last_delivery_error = delivery_error[:2000]
        if permanent_failure or message.delivery_attempts >= MAX_DELIVERY_ATTEMPTS:
            message.status = MessageStatus.FAILED
            message.next_delivery_attempt_at = None
        else:
            message.next_delivery_attempt_at = now + RETRY_DELAY
        message.save(
            update_fields=(
                'status', 'delivery_attempts', 'next_delivery_attempt_at',
                'last_delivery_error', 'updated_at',
            ),
        )
        if message.status == MessageStatus.FAILED:
            create_delivery_failure_notifications(message)
            payload = {
                'event': 'message_status_updated',
                'chat_id': str(message.chat_id),
                'message_id': str(message.id),
                'status': MessageStatus.FAILED,
            }
            transaction.on_commit(
                lambda: broadcast_workspace_event(
                    message.chat.workspace_id,
                    payload,
                ),
            )
    return True


def process_pending_outgoing_messages(*, limit=100, client=None, now=None):
    now = now or timezone.now()
    message_ids = list(
        Message.objects.filter(
            sender_type=MessageSenderType.USER,
            status=MessageStatus.SENT,
            is_deleted=False,
            next_delivery_attempt_at__lte=now,
        ).order_by('next_delivery_attempt_at', 'created_at')
        .values_list('id', flat=True)[:limit],
    )
    processed = 0
    for message_id in message_ids:
        if process_outgoing_message(message_id, client=client, now=now):
            processed += 1
    return processed
