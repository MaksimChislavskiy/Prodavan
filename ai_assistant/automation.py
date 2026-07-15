import hashlib
import html
import json
import re
from datetime import datetime, time as datetime_time, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.exceptions import ValidationError

from contacts.models import Contact
from contacts.services import ContactServiceError, update_contact
from deals.models import ChangedByType, Deal, DealEvent, DealHistory
from deals.services import CRMServiceError, create_deal, update_deal
from messaging.models import Message, MessageSenderType
from tasks.dates import normalize_due_date, workspace_timezone
from tasks.models import DueDateType, Task, TaskSource
from tasks.services import TaskServiceError, create_task
from users.models import User

from .audit import audit_automation_event, audit_automation_failure
from .chat_client import (
    ChatCompletionClient,
    ChatConfigurationError,
    ChatServiceError,
    ChatTimeoutError,
    EmptyChatResponseError,
)
from .insights import apply_structured_insights
from .limits import AI_LIMITS
from .models import (
    AIChatInsight,
    AIAutomationEvent,
    AIProcessedEvent,
    AIUsageDaily,
    AutomationActionType,
    AutomationEventStatus,
    AutomationFailureType,
)
from .rate_limits import AIRateLimitExceeded, consume_workspace_ai_request


EVENT_CHAT_MESSAGE_RECEIVED = 'chat_message_received'
RETRY_DELAYS = (1, 5, 15)
CHAT_ANALYSIS_THROTTLE = timedelta(seconds=5)
PROCESSED_EVENT_RETENTION = timedelta(hours=24)
DEAL_CREATE_CONFIDENCE_THRESHOLD = Decimal('0.8')
INSIGHT_MESSAGE_STEP = 5


class AutomationBusinessError(Exception):
    pass


class AutomationTechnicalError(Exception):
    pass


class AutomationAnalysisClient:
    def __init__(self, chat_client=None):
        self.chat_client = chat_client or ChatCompletionClient(retry_attempts=1)

    def analyze(self, *, event, context_messages):
        try:
            consume_workspace_ai_request(event.workspace_id)
            result = self.chat_client.complete([
                {
                    'role': 'system',
                    'content': (
                        'Ты CRM-аналитик для входящих сообщений. '
                        'Верни только JSON-объект без Markdown. '
                        'Не придумывай факты, используй confidence от 0 до 1. '
                        'Схема: {'
                        '"contact":{"confidence":0,"fields":{}},'
                        '"deal":{"interest_confidence":0,"create":false,'
                        '"name":"","amount":null,"currency":"RUB","comment":"",'
                        '"fields":{}},'
                        '"task":{"confidence":0,"create":false,"title":"",'
                        '"description":"","due_date":null,'
                        '"due_date_type":"none","duplicate":false,'
                        '"comment":""},'
                        '"insight":{"summary":"","sentiment":"",'
                        '"needs":null,"budget":null,"timeline":null,'
                        '"objections":[],"next_step":null,"probability":null,'
                        '"confidence":0,"recommendations":[]}'
                        '}. Для task ограничь description 500 символами. '
                        'Относительный срок возвращай как YYYY-MM-DD с '
                        'due_date_type=date, явное время — как datetime. '
                        'Для времени без даты можно вернуть HH:MM. '
                        'Если договорённость дублирует уже поставленную задачу, '
                        'укажи duplicate=true.'
                    ),
                },
                {
                    'role': 'user',
                    'content': json.dumps(
                        {
                            'workspace_timezone': event.workspace.timezone,
                            'current_datetime': timezone.now().astimezone(
                                workspace_timezone(event.workspace),
                            ).isoformat(),
                            'contact': _contact_context(event.chat.contact),
                            'current_message_id': str(event.message_id),
                            'current_message_text': event.message.text,
                            'context_messages': context_messages,
                        },
                        ensure_ascii=False,
                        default=str,
                    ),
                },
            ])
        except ChatConfigurationError as error:
            raise AutomationBusinessError(
                'AI chat client is not configured.',
            ) from error
        except AIRateLimitExceeded as error:
            raise AutomationTechnicalError('ai_rate_limit_exceeded') from error
        except (ChatTimeoutError, EmptyChatResponseError, ChatServiceError) as error:
            raise AutomationTechnicalError(str(error) or type(error).__name__) from error

        return _parse_analysis_json(result.content)


def enqueue_automation_event(message):
    if message.sender_type not in {
        MessageSenderType.CONTACT,
        MessageSenderType.USER,
    }:
        return None
    if message.sent_by_ai or message.is_deleted:
        return None

    chat = message.chat
    if not _workspace_has_authorized_user(chat.workspace_id):
        return None
    event, _ = AIAutomationEvent.objects.get_or_create(
        message=message,
        defaults={
            'workspace_id': chat.workspace_id,
            'chat_id': chat.id,
            'event_type': EVENT_CHAT_MESSAGE_RECEIVED,
            'status': AutomationEventStatus.PENDING,
        },
    )
    return event


def process_pending_automation_events(*, limit=100, analyzer=None):
    cleanup_expired_processed_events()
    now = timezone.now()
    event_ids = list(
        AIAutomationEvent.objects.filter(
            status=AutomationEventStatus.PENDING,
            available_at__lte=now,
        )
        .order_by('available_at', 'created_at', 'id')
        .values_list('id', flat=True)[:limit],
    )
    result = {
        'processed': 0,
        'completed': 0,
        'failed': 0,
        'ignored': 0,
        'rescheduled': 0,
    }
    for event_id in event_ids:
        outcome = process_automation_event(event_id, analyzer=analyzer)
        if outcome in {'completed', 'failed', 'ignored'}:
            result['processed'] += 1
        if outcome in result:
            result[outcome] += 1
    return result


def process_automation_event(event_id, *, analyzer=None):
    claim = _claim_event(event_id)
    if claim in {'missing', 'not_ready', 'not_pending'}:
        return claim
    if claim in {'ignored', 'rescheduled'}:
        return claim

    analyzer = analyzer or AutomationAnalysisClient()
    try:
        event = _event_for_processing(event_id)
        context_messages = _last_context_messages(event.chat, event.message)
        analysis = analyzer.analyze(event=event, context_messages=context_messages)
        action_results = _apply_actions(event, analysis)
    except AutomationBusinessError as error:
        _mark_business_failure(event_id, error)
        return 'failed'
    except AutomationTechnicalError as error:
        return _mark_technical_failure(event_id, error)
    except (CRMServiceError, TaskServiceError, ContactServiceError, ValidationError) as error:
        _mark_business_failure(event_id, error)
        return 'failed'
    except Exception as error:
        return _mark_technical_failure(event_id, error)

    AIAutomationEvent.objects.filter(id=event_id).update(
        status=AutomationEventStatus.COMPLETED,
        processed_at=timezone.now(),
        locked_at=None,
        failure_type='',
        last_error='',
        analysis=_json_safe({'analysis': analysis, 'actions': action_results}),
    )
    audit_automation_event(
        event=event,
        analysis=analysis,
        action_results=action_results,
    )
    return 'completed'


def cleanup_expired_processed_events(now=None):
    now = now or timezone.now()
    return AIProcessedEvent.objects.filter(expires_at__lte=now).delete()[0]


def _claim_event(event_id):
    now = timezone.now()
    with transaction.atomic():
        event = (
            AIAutomationEvent.objects.select_for_update()
            .select_related('message', 'chat')
            .filter(id=event_id)
            .first()
        )
        if event is None:
            return 'missing'
        if event.status != AutomationEventStatus.PENDING:
            return 'not_pending'
        if event.available_at and event.available_at > now:
            return 'not_ready'
        if _should_ignore_event(event):
            event.status = AutomationEventStatus.IGNORED
            event.processed_at = now
            event.locked_at = None
            event.last_error = 'Message is not eligible for AI automation.'
            event.save(update_fields=(
                'status',
                'processed_at',
                'locked_at',
                'last_error',
                'updated_at',
            ))
            return 'ignored'

        last_processed_at = (
            AIAutomationEvent.objects.filter(
                chat=event.chat,
                processed_at__gt=now - CHAT_ANALYSIS_THROTTLE,
            )
            .exclude(id=event.id)
            .order_by('-processed_at')
            .values_list('processed_at', flat=True)
            .first()
        )
        if last_processed_at is not None:
            event.available_at = max(
                now + timedelta(seconds=1),
                last_processed_at + CHAT_ANALYSIS_THROTTLE,
            )
            event.last_error = 'Chat analysis throttled.'
            event.save(update_fields=('available_at', 'last_error', 'updated_at'))
            return 'rescheduled'

        event.status = AutomationEventStatus.PROCESSING
        event.attempts += 1
        event.locked_at = now
        event.last_error = ''
        event.save(update_fields=(
            'status',
            'attempts',
            'locked_at',
            'last_error',
            'updated_at',
        ))
    return 'claimed'


def _should_ignore_event(event):
    message = event.message
    return (
        message.sender_type not in {
            MessageSenderType.CONTACT,
            MessageSenderType.USER,
        }
        or message.sent_by_ai
        or message.is_deleted
        or event.event_type != EVENT_CHAT_MESSAGE_RECEIVED
        or not _workspace_has_authorized_user(event.workspace_id)
    )


def _workspace_has_authorized_user(workspace_id):
    return User.objects.filter(
        workspace_id=workspace_id,
        is_active=True,
        is_deleted=False,
    ).exists()


def _event_for_processing(event_id):
    return (
        AIAutomationEvent.objects.select_related(
            'workspace',
            'chat',
            'chat__contact',
            'message',
        )
        .get(id=event_id)
    )


def _last_context_messages(chat, message):
    messages = list(
        Message.objects.filter(
            chat=chat,
            is_deleted=False,
            created_at__lte=message.created_at,
        )
        .order_by('-created_at', '-id')[:5],
    )
    messages.reverse()
    return [
        {
            'id': str(item.id),
            'sender_type': item.sender_type,
            'text': item.text,
            'created_at': item.created_at.isoformat(),
        }
        for item in messages
    ]


def _mark_business_failure(event_id, error):
    error_text = _error_text(error)
    AIAutomationEvent.objects.filter(id=event_id).update(
        status=AutomationEventStatus.FAILED,
        processed_at=timezone.now(),
        locked_at=None,
        failure_type=AutomationFailureType.BUSINESS,
        last_error=error_text,
    )
    audit_automation_failure(
        event=_event_for_failure_audit(event_id),
        error_text=error_text,
        failure_type=AutomationFailureType.BUSINESS,
    )


def _mark_technical_failure(event_id, error):
    now = timezone.now()
    error_text = _error_text(error)
    with transaction.atomic():
        event = AIAutomationEvent.objects.select_for_update().get(id=event_id)
        if event.attempts <= len(RETRY_DELAYS):
            event.status = AutomationEventStatus.PENDING
            event.available_at = now + timedelta(seconds=RETRY_DELAYS[event.attempts - 1])
            outcome = 'rescheduled'
        else:
            event.status = AutomationEventStatus.FAILED
            event.processed_at = now
            outcome = 'failed'
        event.locked_at = None
        event.failure_type = AutomationFailureType.TECHNICAL
        event.last_error = error_text
        event.save(update_fields=(
            'status',
            'available_at',
            'processed_at',
            'locked_at',
            'failure_type',
            'last_error',
            'updated_at',
        ))
    if outcome == 'failed':
        audit_automation_failure(
            event=_event_for_failure_audit(event_id),
            error_text=error_text,
            failure_type=AutomationFailureType.TECHNICAL,
        )
    return outcome


def _event_for_failure_audit(event_id):
    return (
        AIAutomationEvent.objects.select_related(
            'workspace',
            'chat',
            'message',
        )
        .get(id=event_id)
    )


def _apply_actions(event, analysis):
    analysis = analysis if isinstance(analysis, dict) else {}
    results = {}
    if event.contact_created:
        results[AutomationActionType.CONTACT_CREATE] = _record_action(
            event,
            AutomationActionType.CONTACT_CREATE,
            {
                'status': 'created',
                'contact_id': str(event.chat.contact_id),
            },
        )
    contact_message = event.message.sender_type == MessageSenderType.CONTACT
    if contact_message:
        results[AutomationActionType.CONTACT_ENRICHMENT] = _enrich_contact(
            event,
            analysis,
        )
    else:
        results[AutomationActionType.CONTACT_ENRICHMENT] = _record_action(
            event,
            AutomationActionType.CONTACT_ENRICHMENT,
            {'status': 'skipped_sender_not_eligible'},
        )
    deal = _create_deal_if_needed(event, analysis)
    results[AutomationActionType.DEAL_CREATE] = deal['result']
    active_deal = deal['deal'] or _active_deal_for_contact(event.workspace, event.chat.contact)
    if contact_message:
        results[AutomationActionType.DEAL_ENRICHMENT] = _enrich_deal(
            event,
            analysis,
            active_deal,
        )
    else:
        results[AutomationActionType.DEAL_ENRICHMENT] = _record_action(
            event,
            AutomationActionType.DEAL_ENRICHMENT,
            {'status': 'skipped_sender_not_eligible'},
        )
    results[AutomationActionType.TASK_CREATE] = _create_task_if_needed(
        event,
        analysis,
        active_deal,
    )
    results[AutomationActionType.INSIGHT] = _create_insight_if_due(
        event,
        analysis,
        active_deal,
    )
    return results


def _enrich_contact(event, analysis):
    action_type = AutomationActionType.CONTACT_ENRICHMENT
    if _action_already_processed(event, action_type):
        return {'status': 'already_processed'}

    contact_data = _dict_value(analysis.get('contact'))
    if _confidence(contact_data) < _confidence_threshold():
        return _record_action(event, action_type, {'status': 'skipped_low_confidence'})

    fields = _dict_value(contact_data.get('fields')) or contact_data
    contact = Contact.objects.filter(
        id=event.chat.contact_id,
        workspace=event.workspace,
        is_deleted=False,
    ).first()
    if contact is None:
        return _record_action(event, action_type, {'status': 'skipped_no_contact'})

    updates = _empty_contact_updates(contact, fields)
    if not updates:
        return _record_action(event, action_type, {'status': 'skipped_no_empty_fields'})

    with transaction.atomic():
        usage = _usage_for_update(event.workspace)
        if usage.contacts_updated >= AI_LIMITS['daily_contact_updates']:
            return _record_action(event, action_type, {'status': 'skipped_daily_limit'})
        updated = update_contact(
            workspace=event.workspace,
            user=None,
            contact_id=contact.id,
            submitted_version=contact.version,
            data=updates,
            audit_changes={
                'source': 'ai',
                'trigger': 'data_enrichment',
            },
        )
        usage.contacts_updated += 1
        usage.save(update_fields=('contacts_updated',))
        return _record_action(
            event,
            action_type,
            {
                'status': 'updated',
                'contact_id': str(updated.id),
                'fields': sorted(updates),
            },
        )


def _create_deal_if_needed(event, analysis):
    action_type = AutomationActionType.DEAL_CREATE
    empty = {'deal': None, 'result': {'status': 'already_processed'}}
    if _action_already_processed(event, action_type):
        return empty

    deal_data = _dict_value(analysis.get('deal'))
    confidence = _confidence(deal_data, 'interest_confidence')
    wants_create = bool(deal_data.get('create')) or bool(_text(deal_data.get('name')))
    if not wants_create or confidence < DEAL_CREATE_CONFIDENCE_THRESHOLD:
        result = _record_action(
            event,
            action_type,
            {'status': 'skipped_low_interest'},
        )
        return {'deal': None, 'result': result}

    contact = event.chat.contact
    if _active_deal_for_contact(event.workspace, contact) is not None:
        result = _record_action(
            event,
            action_type,
            {'status': 'skipped_active_deal_exists'},
        )
        return {'deal': None, 'result': result}
    if _ai_deal_created_recently(event.workspace, contact):
        result = _record_action(
            event,
            action_type,
            {'status': 'skipped_recent_ai_deal'},
        )
        return {'deal': None, 'result': result}

    idempotency_key = _action_key(event.message_id, action_type)
    payload = {
        'name': _text(deal_data.get('name'), 255) or f'Заявка от {contact.name}',
        'amount': _decimal_or_none(deal_data.get('amount')),
        'currency': 'RUB',
        'contact_id': contact.id,
        'comment': _text(deal_data.get('comment'), 500),
    }
    with transaction.atomic():
        usage = _usage_for_update(event.workspace)
        if usage.deals_created >= AI_LIMITS['daily_deal_creation']:
            result = _record_action(
                event,
                action_type,
                {'status': 'skipped_daily_limit'},
            )
            return {'deal': None, 'result': result}
        body, response_status = create_deal(
            workspace=event.workspace,
            user=None,
            data=payload,
            idempotency_key=idempotency_key,
            changed_by_type=ChangedByType.AI,
        )
        if response_status == status.HTTP_201_CREATED:
            usage.deals_created += 1
            usage.save(update_fields=('deals_created',))
            now = timezone.now()
            Contact.objects.filter(
                id=contact.id,
                workspace=event.workspace,
                is_deleted=False,
            ).update(last_ai_deal_created_at=now, updated_at=now)
            contact.last_ai_deal_created_at = now
        deal = Deal.objects.filter(id=body.get('id')).first()
        result = _record_action(
            event,
            action_type,
            {
                'status': 'created' if response_status == status.HTTP_201_CREATED else 'reused',
                'deal_id': str(body.get('id')),
                'response_status': response_status,
            },
        )
    return {'deal': deal, 'result': result}


def _enrich_deal(event, analysis, deal):
    action_type = AutomationActionType.DEAL_ENRICHMENT
    if _action_already_processed(event, action_type):
        return {'status': 'already_processed'}
    if deal is None:
        return _record_action(event, action_type, {'status': 'skipped_no_deal'})

    deal_data = _dict_value(analysis.get('deal'))
    if _confidence(deal_data) < _confidence_threshold():
        return _record_action(event, action_type, {'status': 'skipped_low_confidence'})

    fields = _dict_value(deal_data.get('fields')) or deal_data
    updates = _empty_deal_updates(deal, fields)
    if not updates:
        return _record_action(event, action_type, {'status': 'skipped_no_empty_fields'})

    with transaction.atomic():
        usage = _usage_for_update(event.workspace)
        if usage.contacts_updated >= AI_LIMITS['daily_contact_updates']:
            return _record_action(event, action_type, {'status': 'skipped_daily_limit'})
        response = update_deal(
            workspace=event.workspace,
            user=None,
            deal_id=deal.id,
            submitted_version=deal.version,
            data=updates,
            changed_by_type=ChangedByType.AI,
        )
        usage.contacts_updated += 1
        usage.save(update_fields=('contacts_updated',))
        return _record_action(
            event,
            action_type,
            {
                'status': 'updated',
                'deal_id': str(response['id']),
                'fields': sorted(updates),
            },
        )


def _create_task_if_needed(event, analysis, deal):
    action_type = AutomationActionType.TASK_CREATE
    if _action_already_processed(event, action_type):
        return {'status': 'already_processed'}

    task_data = _dict_value(analysis.get('task'))
    title = _text(task_data.get('title'), 255)
    wants_create = bool(task_data.get('create')) or bool(title)
    if not wants_create or _confidence(task_data) < _confidence_threshold() or not title:
        return _record_action(event, action_type, {'status': 'skipped_low_confidence'})
    if (
        task_data.get('duplicate') is True
        or task_data.get('is_duplicate') is True
        or _duplicate_ai_task(event.chat, title)
    ):
        return _record_action(event, action_type, {'status': 'skipped_duplicate'})

    due_date_type = task_data.get('due_date_type') or DueDateType.NONE
    if due_date_type not in DueDateType.values:
        due_date_type = DueDateType.NONE
    due_date = _task_due_date(task_data.get('due_date'), due_date_type, event.workspace)
    if due_date_type != DueDateType.NONE and due_date is None:
        return _record_action(event, action_type, {'status': 'skipped_invalid_due_date'})

    idempotency_key = _action_key(event.message_id, action_type)
    with transaction.atomic():
        usage = _usage_for_update(event.workspace)
        if usage.tasks_created >= AI_LIMITS['daily_task_creation']:
            return _record_action(event, action_type, {'status': 'skipped_daily_limit'})
        if _tasks_created_for_chat_24h(event.chat) >= AI_LIMITS['tasks_per_chat_24h']:
            return _record_action(event, action_type, {'status': 'skipped_chat_limit'})
        body, response_status = create_task(
            workspace=event.workspace,
            user=None,
            data={
                'title': title,
                'description': _text(task_data.get('description'), 500),
                'due_date': due_date,
                'due_date_type': due_date_type,
                'contact_id': event.chat.contact_id,
                'deal_id': deal.id if deal else None,
                'comment': 'Создана AI из чата',
            },
            idempotency_key=idempotency_key,
            source=TaskSource.AI,
            source_chat=event.chat,
        )
        if response_status == status.HTTP_201_CREATED:
            usage.tasks_created += 1
            usage.save(update_fields=('tasks_created',))
        return _record_action(
            event,
            action_type,
            {
                'status': 'created' if response_status == status.HTTP_201_CREATED else 'reused',
                'task_id': str(body.get('id')),
                'response_status': response_status,
            },
        )


def _create_insight_if_due(event, analysis, deal):
    action_type = AutomationActionType.INSIGHT
    if _action_already_processed(event, action_type):
        return {'status': 'already_processed'}

    total_message_count, pending_message_count = _insight_message_counts(event)
    if pending_message_count < INSIGHT_MESSAGE_STEP:
        return _record_action(
            event,
            action_type,
            {
                'status': 'skipped_not_due',
                'message_count': pending_message_count,
                'total_message_count': total_message_count,
            },
        )

    insight_data = _dict_value(analysis.get('insight'))
    summary = (
        _text(insight_data.get('summary'), 2000)
        or _text(event.message.text, 2000)
        or ''
    )
    insight = AIChatInsight.objects.create(
        workspace=event.workspace,
        chat=event.chat,
        source_message=event.message,
        message_count=total_message_count,
        summary=summary,
        sentiment=_text(insight_data.get('sentiment'), 32) or '',
        objections=_string_list(insight_data.get('objections')),
        recommendations=_string_list(insight_data.get('recommendations')),
    )
    structured_result = apply_structured_insights(
        contact=event.chat.contact,
        deal=deal,
        insight_data=insight_data,
        analyzed_at=insight.created_at,
    )
    return _record_action(
        event,
        action_type,
        {
            'status': 'created',
            'insight_id': str(insight.id),
            'message_count': total_message_count,
            'batch_message_count': INSIGHT_MESSAGE_STEP,
            'structured': structured_result,
        },
    )


def _insight_message_counts(event):
    messages = Message.objects.filter(
        chat=event.chat,
        sender_type__in=(
            MessageSenderType.CONTACT,
            MessageSenderType.USER,
        ),
        sent_by_ai=False,
        is_deleted=False,
        created_at__lte=event.message.created_at,
    )
    total_message_count = messages.count()
    last_insight = (
        AIChatInsight.objects.filter(chat=event.chat)
        .select_related('source_message')
        .order_by('-source_message__created_at', '-created_at', '-id')
        .first()
    )
    if last_insight is not None:
        messages = messages.filter(
            created_at__gt=last_insight.source_message.created_at,
        )
    return total_message_count, messages.count()


def _record_action(event, action_type, result):
    key = _action_key(event.message_id, action_type)
    existing = AIProcessedEvent.objects.filter(idempotency_key=key).first()
    if existing is not None:
        return existing.result
    result = _json_safe(result)
    AIProcessedEvent.objects.create(
        workspace=event.workspace,
        event=event,
        chat=event.chat,
        action_type=action_type,
        idempotency_key=key,
        result=result,
        expires_at=timezone.now() + PROCESSED_EVENT_RETENTION,
    )
    return result


def _action_already_processed(event, action_type):
    key = _action_key(event.message_id, action_type)
    return AIProcessedEvent.objects.filter(idempotency_key=key).exists()


def _action_key(message_id, action_type):
    return hashlib.sha256(f'{message_id}:{action_type}'.encode()).hexdigest()


def _usage_for_update(workspace):
    usage, _ = AIUsageDaily.objects.select_for_update().get_or_create(
        workspace=workspace,
        date=_workspace_local_date(workspace),
    )
    return usage


def _workspace_local_date(workspace, now=None):
    now = now or timezone.now()
    try:
        zone = ZoneInfo(workspace.timezone or 'UTC')
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo('UTC')
    return now.astimezone(zone).date()


def _active_deal_for_contact(workspace, contact):
    if contact is None:
        return None
    return (
        Deal.objects.filter(
            workspace=workspace,
            contact=contact,
            stage__is_final=False,
            is_deleted=False,
        )
        .order_by('-updated_at', '-id')
        .first()
    )


def _ai_deal_created_recently(workspace, contact):
    if contact is None:
        return False
    recent_after = timezone.now() - timedelta(hours=24)
    if (
        contact.last_ai_deal_created_at is not None
        and contact.last_ai_deal_created_at >= recent_after
    ):
        return True
    return DealHistory.objects.filter(
        workspace=workspace,
        deal__contact=contact,
        event_type=DealEvent.CREATED,
        changed_by_type=ChangedByType.AI,
        created_at__gte=recent_after,
    ).exists()


def _tasks_created_for_chat_24h(chat):
    return Task.objects.filter(
        workspace=chat.workspace,
        source_chat=chat,
        created_by_ai=True,
        is_deleted=False,
        created_at__gte=timezone.now() - timedelta(hours=24),
    ).count()


def _duplicate_ai_task(chat, title):
    return Task.objects.filter(
        workspace=chat.workspace,
        source_chat=chat,
        created_by_ai=True,
        is_deleted=False,
        title__iexact=title.strip(),
        created_at__gte=timezone.now() - timedelta(hours=24),
    ).exists()


def _empty_contact_updates(contact, fields):
    allowed = {
        'name': 100,
        'company': 100,
        'phone': 16,
        'email': 255,
        'telegram': 33,
        'comment': None,
    }
    updates = {}
    for field, max_length in allowed.items():
        current = getattr(contact, field)
        if field == 'name':
            empty = not (current or '').strip()
        else:
            empty = current in {None, ''}
        if not empty:
            continue
        value = _text(fields.get(field), max_length)
        if value is not None:
            updates[field] = value
    return updates


def _empty_deal_updates(deal, fields):
    updates = {}
    if deal.amount is None:
        amount = _decimal_or_none(fields.get('amount'))
        if amount is not None:
            updates['amount'] = amount
    if not deal.comment:
        comment = _text(fields.get('comment'), 500)
        if comment is not None:
            updates['comment'] = comment
    return updates


def _task_due_date(value, due_date_type, workspace):
    if due_date_type == DueDateType.NONE:
        return None
    if isinstance(value, datetime):
        return normalize_due_date(value, workspace=workspace)
    value = _text(value)
    if value is None:
        return None
    if due_date_type == DueDateType.DATETIME:
        time_only = re.fullmatch(
            r'(?:в\s*)?([01]?\d|2[0-3]):([0-5]\d)',
            value,
            flags=re.IGNORECASE,
        )
        if time_only is not None:
            zone = workspace_timezone(workspace)
            local_now = timezone.now().astimezone(zone)
            parsed = datetime.combine(
                local_now.date(),
                datetime_time(
                    hour=int(time_only.group(1)),
                    minute=int(time_only.group(2)),
                ),
                tzinfo=zone,
            )
            if parsed <= local_now:
                parsed += timedelta(days=1)
            return normalize_due_date(parsed, workspace=workspace)
    parsed = parse_datetime(value)
    try:
        return normalize_due_date(parsed or value, workspace=workspace)
    except ValidationError:
        return None


def _contact_context(contact):
    return {
        'id': str(contact.id),
        'name': contact.name,
        'company': contact.company,
        'phone': contact.phone,
        'email': contact.email,
        'telegram': contact.telegram,
        'comment': contact.comment,
    }


def _parse_analysis_json(content):
    content = html.unescape(content or '').strip()
    match = re.search(r'```(?:json)?\s*(.*?)\s*```', content, re.DOTALL)
    if match:
        content = match.group(1).strip()
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as error:
        raise AutomationBusinessError('AI returned invalid JSON.') from error
    if not isinstance(payload, dict):
        raise AutomationBusinessError('AI returned non-object JSON.')
    return payload


def _dict_value(value):
    return value if isinstance(value, dict) else {}


def _confidence(data, key='confidence'):
    value = data.get(key)
    if value is None and key != 'confidence':
        value = data.get('confidence')
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal('0')
    return max(Decimal('0'), min(Decimal('1'), number))


def _confidence_threshold():
    try:
        return Decimal(str(settings.AI_AUTOMATION_CONFIDENCE_THRESHOLD))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal('0.7')


def _decimal_or_none(value):
    if value in (None, ''):
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if amount < 0:
        return None
    return amount.quantize(Decimal('0.01'))


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
    if not isinstance(value, list):
        return []
    result = []
    for item in value[:10]:
        text = _text(item, 255)
        if text is not None:
            result.append(text)
    return result


def _json_safe(value):
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _error_text(error):
    text = str(error) or type(error).__name__
    return text[:2000]
