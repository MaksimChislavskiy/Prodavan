import json

from contacts.models import Contact
from deals.models import Deal
from tasks.models import Task

from .models import AIChatContextPage


class CRMContextNotFound(Exception):
    pass


MAX_RELATED_DEALS = 50


def build_crm_context(session):
    page = session.context_page or AIChatContextPage.DASHBOARD
    if page == AIChatContextPage.DEALS and session.context_entity_id is not None:
        return _deal_context(session)
    if page == AIChatContextPage.CONTACTS and session.context_entity_id is not None:
        return _contact_context(session)
    if page == AIChatContextPage.TASKS and session.context_entity_id is not None:
        return _task_context(session)
    return _json_context({
        'page': page,
        'entity_id': (
            str(session.context_entity_id)
            if session.context_entity_id is not None
            else None
        ),
        'entity': None,
    })


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


def _json_context(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    )
