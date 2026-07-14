import json

from contacts.models import Contact
from deals.models import Deal
from messaging.models import Chat
from tasks.models import Task

from .models import AIChatContextPage
from .workspace_context import build_workspace_context


class CRMContextNotFound(Exception):
    pass


MAX_RELATED_DEALS = 50
MAX_CHAT_MESSAGES = 50
MAX_CHAT_HISTORY_CHARS = 20_000


def build_crm_context(session):
    page = session.context_page or AIChatContextPage.DASHBOARD
    if page == AIChatContextPage.DEALS and session.context_entity_id is not None:
        return _deal_context(session)
    if page == AIChatContextPage.CONTACTS and session.context_entity_id is not None:
        return _contact_context(session)
    if page == AIChatContextPage.TASKS and session.context_entity_id is not None:
        return _task_context(session)
    if page == AIChatContextPage.CHAT and session.context_entity_id is not None:
        return _chat_context(session)
    return _json_context(build_workspace_context(session, page))


def _deal_context(session):
    deal = (
        Deal.objects.select_related('stage', 'contact')
        .filter(
            id=session.context_entity_id,
            workspace_id=session.workspace_id,
            is_deleted=False,
        )
        .first()
    )
    if deal is None:
        raise CRMContextNotFound

    contact = None
    if deal.contact is not None and not deal.contact.is_deleted:
        contact = {
            'id': str(deal.contact.id),
            'name': deal.contact.name,
            'company': deal.contact.company,
            'phone': deal.contact.phone,
            'email': deal.contact.email,
            'telegram': deal.contact.telegram,
        }
    return _json_context({
        'page': AIChatContextPage.DEALS,
        'entity_id': str(deal.id),
        'deal': {
            'id': str(deal.id),
            'name': deal.name,
            'stage': {
                'id': str(deal.stage.id),
                'name': deal.stage.name,
            },
            'amount': str(deal.amount) if deal.amount is not None else None,
            'currency': deal.currency,
            'contact': contact,
        },
    })


def _contact_context(session):
    contact = (
        Contact.objects.filter(
            id=session.context_entity_id,
            workspace_id=session.workspace_id,
            is_deleted=False,
        )
        .first()
    )
    if contact is None:
        raise CRMContextNotFound

    deals = contact.deals.select_related('stage').filter(
        workspace_id=session.workspace_id,
        is_deleted=False,
    ).order_by('-updated_at', '-id')
    deal_count = deals.count()
    related_deals = [
        {
            'id': str(deal.id),
            'name': deal.name,
            'stage': {
                'id': str(deal.stage.id),
                'name': deal.stage.name,
            },
            'amount': str(deal.amount) if deal.amount is not None else None,
            'currency': deal.currency,
        }
        for deal in deals[:MAX_RELATED_DEALS]
    ]
    return _json_context({
        'page': AIChatContextPage.CONTACTS,
        'entity_id': str(contact.id),
        'contact': {
            'id': str(contact.id),
            'name': contact.name,
            'company': contact.company,
            'phone': contact.phone,
            'email': contact.email,
            'telegram': contact.telegram,
            'comment': contact.comment,
            'ai_insights': contact.ai_insights,
        },
        'related_deal_count': deal_count,
        'related_deals_truncated': deal_count > len(related_deals),
        'related_deals': related_deals,
    })


def _task_context(session):
    task = (
        Task.objects.select_related('contact', 'deal', 'deal__stage')
        .filter(
            id=session.context_entity_id,
            workspace_id=session.workspace_id,
            is_deleted=False,
        )
        .first()
    )
    if task is None:
        raise CRMContextNotFound

    contact = None
    if (
        task.contact is not None
        and task.contact.workspace_id == session.workspace_id
        and not task.contact.is_deleted
    ):
        contact = {
            'id': str(task.contact.id),
            'name': task.contact.name,
            'company': task.contact.company,
            'phone': task.contact.phone,
            'email': task.contact.email,
            'telegram': task.contact.telegram,
        }

    deal = None
    if (
        task.deal is not None
        and task.deal.workspace_id == session.workspace_id
        and not task.deal.is_deleted
    ):
        deal = {
            'id': str(task.deal.id),
            'name': task.deal.name,
            'stage': {
                'id': str(task.deal.stage.id),
                'name': task.deal.stage.name,
            },
            'amount': (
                str(task.deal.amount) if task.deal.amount is not None else None
            ),
            'currency': task.deal.currency,
        }

    return _json_context({
        'page': AIChatContextPage.TASKS,
        'entity_id': str(task.id),
        'task': {
            'id': str(task.id),
            'title': task.title,
            'description': task.description,
            'status': task.status,
            'due_date': task.due_date.isoformat() if task.due_date else None,
            'due_date_type': task.due_date_type,
            'comment': task.comment,
            'created_by_ai': task.created_by_ai,
            'contact': contact,
            'deal': deal,
        },
    })


def _chat_context(session):
    chat = (
        Chat.objects.select_related('contact')
        .filter(
            id=session.context_entity_id,
            workspace_id=session.workspace_id,
            is_deleted=False,
        )
        .first()
    )
    if chat is None:
        raise CRMContextNotFound

    contact = None
    if chat.contact.workspace_id == session.workspace_id:
        contact = {
            'id': str(chat.contact.id),
            'name': chat.contact.name,
            'company': chat.contact.company,
            'phone': chat.contact.phone,
            'email': chat.contact.email,
            'telegram': chat.contact.telegram,
            'is_deleted': chat.contact.is_deleted,
        }

    messages = chat.messages.filter(is_deleted=False).order_by(
        '-created_at',
        '-id',
    )
    message_count = messages.count()
    remaining_chars = MAX_CHAT_HISTORY_CHARS
    history = []
    text_was_truncated = False
    for message in messages[:MAX_CHAT_MESSAGES]:
        if remaining_chars <= 0:
            break
        text = message.text
        if len(text) > remaining_chars:
            text = text[:remaining_chars]
            text_was_truncated = True
        history.append({
            'id': str(message.id),
            'sender_type': message.sender_type,
            'sender_id': str(message.sender_id),
            'text': text,
            'text_truncated': len(text) < len(message.text),
            'status': message.status,
            'read_at': message.read_at.isoformat() if message.read_at else None,
            'sent_by_ai': message.sent_by_ai,
            'created_at': message.created_at.isoformat(),
        })
        remaining_chars -= len(text)
        if text_was_truncated:
            break
    history.reverse()

    return _json_context({
        'page': AIChatContextPage.CHAT,
        'entity_id': str(chat.id),
        'chat': {
            'id': str(chat.id),
            'contact': contact,
            'last_message': chat.last_message,
            'last_message_at': (
                chat.last_message_at.isoformat()
                if chat.last_message_at is not None
                else None
            ),
            'unread_count': chat.unread_count,
            'ai_autopilot_enabled': chat.ai_autopilot_enabled,
        },
        'message_count': message_count,
        'history_included_count': len(history),
        'history_truncated': (
            message_count > len(history) or text_was_truncated
        ),
        'history': history,
    })


def _json_context(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    )
