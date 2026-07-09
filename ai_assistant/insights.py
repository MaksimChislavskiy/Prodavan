from copy import deepcopy

from django.utils import timezone


INSIGHT_FIELDS = (
    'needs',
    'budget',
    'timeline',
    'objections',
    'next_step',
    'probability',
    'last_analyzed_at',
    'confidence',
)


def empty_ai_insights():
    return {
        'needs': None,
        'budget': None,
        'timeline': None,
        'objections': None,
        'next_step': None,
        'probability': None,
        'last_analyzed_at': None,
        'confidence': None,
    }


def apply_structured_insights(*, contact, deal=None, insight_data=None, analyzed_at=None):
    structured = normalize_structured_insights(
        insight_data or {},
        analyzed_at=analyzed_at or timezone.now(),
    )
    if not _has_payload(structured):
        return {'status': 'skipped_no_structured_data', 'changes': {}}

    result = {'status': 'updated', 'changes': {}}
    contact_changes = update_object_insights(contact, structured)
    if contact_changes:
        result['changes']['contact'] = contact_changes
    if deal is not None:
        deal_changes = update_object_insights(deal, structured)
        if deal_changes:
            result['changes']['deal'] = deal_changes
    if not result['changes']:
        return {'status': 'skipped_no_changes', 'changes': {}}
    return result


def normalize_structured_insights(data, *, analyzed_at):
    data = data if isinstance(data, dict) else {}
    confidence = _confidence(data.get('confidence'))
    normalized = empty_ai_insights()
    normalized.update({
        'needs': _text(data.get('needs'), 500),
        'budget': _text(data.get('budget'), 255),
        'timeline': _text(data.get('timeline'), 255),
        'objections': _string_list(data.get('objections')),
        'next_step': _text(data.get('next_step'), 500),
        'probability': _probability(data.get('probability')),
        'last_analyzed_at': analyzed_at.isoformat(),
        'confidence': confidence,
    })
    return normalized


def update_object_insights(instance, structured):
    current = _normalized_existing(instance.ai_insights)
    proposed = deepcopy(current)
    changes = {}
    update_allowed = _should_update(current, structured)
    for field in INSIGHT_FIELDS:
        if field in {'last_analyzed_at', 'confidence'}:
            continue
        value = structured.get(field)
        if value in (None, '', []):
            continue
        if current.get(field) == value:
            continue
        if current.get(field) in (None, '', []) or update_allowed:
            changes[field] = {'old': current.get(field), 'new': value}
            proposed[field] = value

    if changes or update_allowed:
        for field in ('last_analyzed_at', 'confidence'):
            value = structured.get(field)
            if value is not None and proposed.get(field) != value:
                changes[field] = {'old': proposed.get(field), 'new': value}
                proposed[field] = value

    if not changes:
        return {}

    instance.ai_insights = proposed
    instance.save(update_fields=('ai_insights', 'updated_at'))
    return changes


def _normalized_existing(value):
    result = empty_ai_insights()
    if isinstance(value, dict):
        for field in INSIGHT_FIELDS:
            if field in value:
                result[field] = value[field]
    return result


def _should_update(current, structured):
    old_confidence = _confidence(current.get('confidence'))
    new_confidence = _confidence(structured.get('confidence'))
    if old_confidence is None:
        return True
    if new_confidence is not None and new_confidence >= old_confidence:
        return True
    return _text(structured.get('last_analyzed_at')) is not None


def _has_payload(structured):
    return any(
        structured.get(field) not in (None, '', [])
        for field in INSIGHT_FIELDS
        if field not in {'last_analyzed_at', 'confidence'}
    )


def _text(value, max_length=None):
    if value is None:
        return None
    value = str(value).strip()
    if not value:
        return None
    if max_length is not None:
        return value[:max_length]
    return value


def _string_list(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return None
    result = []
    for item in value[:10]:
        text = _text(item, 255)
        if text is not None:
            result.append(text)
    return result or None


def _probability(value):
    if value in (None, ''):
        return None
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(0, min(100, number))


def _confidence(value):
    if value in (None, ''):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, number))
