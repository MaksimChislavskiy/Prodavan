import uuid

from django.core import signing
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import Chat, ChatAuditAction, ChatAuditLog, Message, MessageSenderType


CURSOR_SALT = 'prodavan.messaging.cursor.v1'


class ChatServiceError(Exception):
    def __init__(self, code, message, *, status_code=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code

    @property
    def response_data(self):
        return {'error': {'code': self.code, 'message': self.message}}


def request_audit_context(request):
    return {
        'ip_address': request.META.get('REMOTE_ADDR'),
        'user_agent': request.META.get('HTTP_USER_AGENT', '')[:2000],
    }


def write_chat_audit(
    *,
    workspace,
    action,
    user=None,
    chat_id=None,
    message_id=None,
    details=None,
    context=None,
):
    context = context or {}
    ChatAuditLog.objects.create(
        workspace=workspace,
        user=user,
        action=action,
        chat_identifier=chat_id,
        message_identifier=message_id,
        details=details or {},
        ip_address=context.get('ip_address'),
        user_agent=context.get('user_agent', ''),
        correlation_id=uuid.uuid4(),
    )


def _encode_cursor(message):
    return signing.dumps(
        {'created_at': message.created_at.isoformat(), 'id': str(message.id)},
        salt=CURSOR_SALT,
        compress=True,
    )


def _decode_cursor(value):
    try:
        payload = signing.loads(value, salt=CURSOR_SALT)
        created_at = parse_datetime(payload['created_at'])
        message_id = uuid.UUID(payload['id'])
        if created_at is None:
            raise ValueError
        return created_at, message_id
    except (signing.BadSignature, KeyError, TypeError, ValueError):
        raise ChatServiceError(
            'INVALID_CURSOR',
            'Некорректный курсор.',
        ) from None


def get_chat(*, workspace, chat_id):
    chat = Chat.objects.select_related('contact').filter(
        id=chat_id,
        workspace=workspace,
        is_deleted=False,
    ).first()
    if chat is None:
        raise ChatServiceError('CHAT_NOT_FOUND', 'Чат не найден.', status_code=404)
    return chat


def get_messages_page(*, chat, limit, cursor=None):
    queryset = Message.objects.filter(
        chat=chat,
        is_deleted=False,
    ).order_by('-created_at', '-id')
    if cursor:
        created_at, message_id = _decode_cursor(cursor)
        queryset = queryset.filter(
            Q(created_at__lt=created_at)
            | Q(created_at=created_at, id__lt=message_id),
        )
    messages = list(queryset[:limit + 1])
    has_more = len(messages) > limit
    page = messages[:limit]
    next_cursor = _encode_cursor(page[-1]) if has_more and page else None
    return page, next_cursor, has_more


def mark_chat_read(*, workspace, user, chat_id, audit_context=None):
    with transaction.atomic():
        chat = Chat.objects.select_for_update().filter(
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
        now = timezone.now()
        updated = Message.objects.filter(
            chat=chat,
            sender_type=MessageSenderType.CONTACT,
            read_at__isnull=True,
            is_deleted=False,
        ).update(read_at=now, updated_at=now)
        if chat.unread_count:
            chat.unread_count = 0
            chat.save(update_fields=('unread_count', 'updated_at'))
        if updated:
            write_chat_audit(
                workspace=workspace,
                user=user,
                action=ChatAuditAction.MESSAGE_READ,
                chat_id=chat.id,
                details={'read_count': updated},
                context=audit_context,
            )


def delete_chat(*, workspace, user, chat_id, audit_context=None):
    with transaction.atomic():
        chat = Chat.objects.select_for_update().filter(
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
        now = timezone.now()
        chat.is_deleted = True
        chat.deleted_at = now
        chat.save(update_fields=('is_deleted', 'deleted_at', 'updated_at'))
        Message.objects.filter(chat=chat, is_deleted=False).update(
            is_deleted=True,
            updated_at=now,
        )
        write_chat_audit(
            workspace=workspace,
            user=user,
            action=ChatAuditAction.CHAT_DELETED,
            chat_id=chat.id,
            context=audit_context,
        )
