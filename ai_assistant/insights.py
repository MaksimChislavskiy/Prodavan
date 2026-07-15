from copy import deepcopy
from datetime import timezone as datetime_timezone

from django.utils import timezone
from django.utils.dateparse import parse_datetime


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


def format_ai_insights(value):
    result = empty_ai_insights()
    if not isinstance(value, dict):
        return result
    for field in INSIGHT_FIELDS:
        if field in value:
            result[field] = value[field]
    return result


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
    update_reason = _analysis_update_reason(current, structured)
    for field in INSIGHT_FIELDS:
        if field in {'last_analyzed_at', 'confidence'}:
            continue
        value = structured.get(field)
        if value in (None, '', []):
            continue
        if current.get(field) == value:
            continue
        current_value = current.get(field)
        reason = (
            'empty_field'
            if current_value in (None, '', [])
            else update_reason
        )
        if reason is not None:
            changes[field] = {
                'old': current_value,
                'new': value,
                'reason': reason,
            }
            proposed[field] = value

    if changes or update_reason is not None:
        for field in ('last_analyzed_at', 'confidence'):
            value = structured.get(field)
            old_value = proposed.get(field)
            if value is None or old_value == value:
                continue
            if (
                field == 'last_analyzed_at'
                and old_value is not None
                and not _is_newer_analysis(current, structured)
            ):
                continue
            changes[field] = {
                'old': old_value,
                'new': value,
                'reason': update_reason or 'analysis_metadata',
            }
            if field == 'last_analyzed_at' and old_value is None:
                changes[field]['reason'] = 'initial_analysis'
            elif field == 'confidence' and old_value is None:
                changes[field]['reason'] = 'initial_analysis'
            proposed[field] = value

    if not changes:
        return {}

    instance.ai_insights = proposed
    instance.save(update_fields=('ai_insights', 'updated_at'))
    return changes


def _normalized_existing(value):
    return format_ai_insights(value)


def _analysis_update_reason(current, structured):
    old_confidence = _confidence(current.get('confidence'))
    new_confidence = _confidence(structured.get('confidence'))
    if new_confidence is not None and (
        old_confidence is None
        or new_confidence > old_confidence
    ):
        return 'higher_confidence'
    if _is_newer_analysis(current, structured):
        return 'newer_analysis'
    return None


def _is_newer_analysis(current, structured):
    old_analyzed_at = _analyzed_at(current.get('last_analyzed_at'))
    new_analyzed_at = _analyzed_at(structured.get('last_analyzed_at'))
    return new_analyzed_at is not None and (
        old_analyzed_at is None
        or new_analyzed_at > old_analyzed_at
    )


def _analyzed_at(value):
    value = _text(value)
    if value is None:
        return None
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        parsed = parsed.replace(tzinfo=datetime_timezone.utc)
    return parsed


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
