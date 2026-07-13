import json

from deals.models import Deal

from .models import AIChatContextPage


class CRMContextNotFound(Exception):
    pass


def build_crm_context(session):
    page = session.context_page or AIChatContextPage.DASHBOARD
    if page == AIChatContextPage.DEALS and session.context_entity_id is not None:
        return _deal_context(session)
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


def _json_context(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    )
