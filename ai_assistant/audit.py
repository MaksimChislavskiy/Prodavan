import json

from django.db import transaction

from messaging.realtime import broadcast_workspace_event
from notifications.models import NotificationType
from notifications.services import create_notification
from users.models import User

from .models import (
    AIAutomationAuditAction,
    AIAutomationAuditLog,
    AutomationActionType,
)


LIMIT_REASONS = {
    'skipped_daily_limit',
    'skipped_chat_limit',
    'task_spam',
    'workspace_daily_reply_limit',
    'chat_hourly_limit',
    'consecutive_reply_limit',
}


ACTION_BY_SUCCESS = {
    AutomationActionType.CONTACT_CREATE: AIAutomationAuditAction.AI_CONTACT_CREATED,
    AutomationActionType.CONTACT_ENRICHMENT: AIAutomationAuditAction.AI_CONTACT_UPDATED,
    AutomationActionType.DEAL_CREATE: AIAutomationAuditAction.AI_DEAL_CREATED,
    AutomationActionType.DEAL_ENRICHMENT: AIAutomationAuditAction.AI_DEAL_UPDATED,
    AutomationActionType.TASK_CREATE: AIAutomationAuditAction.AI_TASK_CREATED,
    AutomationActionType.INSIGHT: AIAutomationAuditAction.AI_INSIGHTS_EXTRACTED,
    AutomationActionType.AUTOPILOT_REPLY: AIAutomationAuditAction.AI_AUTOPILOT_SENT,
}


TRIGGER_BY_ACTION = {
    AutomationActionType.CONTACT_CREATE: 'first_message',
    AutomationActionType.CONTACT_ENRICHMENT: 'data_enrichment',
    AutomationActionType.DEAL_ENRICHMENT: 'data_enrichment',
    AutomationActionType.TASK_CREATE: 'commitment_detected',
}


NOTIFICATION_BY_ACTION = {
    AIAutomationAuditAction.AI_CONTACT_CREATED: NotificationType.CONTACT_AI_CREATED,
    AIAutomationAuditAction.AI_CONTACT_UPDATED: NotificationType.CONTACT_AI_UPDATED,
    AIAutomationAuditAction.AI_DEAL_CREATED: NotificationType.AI_DEAL_CREATED,
    AIAutomationAuditAction.AI_DEAL_UPDATED: NotificationType.AI_DEAL_UPDATED,
    AIAutomationAuditAction.AI_TASK_CREATED: NotificationType.AI_TASK_CREATED,
    AIAutomationAuditAction.AI_INSIGHTS_EXTRACTED: NotificationType.AI_INSIGHT_EXTRACTED,
    AIAutomationAuditAction.AI_AUTOPILOT_SENT: NotificationType.AI_AUTOPILOT_SENT,
    AIAutomationAuditAction.AI_LIMIT_REACHED: NotificationType.AI_LIMIT_REACHED,
    AIAutomationAuditAction.AI_ACTION_FAILED: NotificationType.AI_ACTION_FAILED,
}


def audit_automation_event(*, event, analysis, action_results):
    logs = []
    for action_type, result in action_results.items():
        if not isinstance(result, dict) or result.get('status') == 'already_processed':
            continue
        details = dict(result)
        details.setdefault('source', 'ai')
        log = _create_log(
            workspace=event.workspace,
            chat=event.chat,
            message=event.message,
            action_type=action_type,
            trigger=TRIGGER_BY_ACTION.get(action_type, event.event_type),
            correlation_id=event.id,
            raw_message=event.message.text,
            ai_response=analysis,
            confidence=_confidence_for_action(analysis, action_type),
            details=details,
        )
        if log is not None:
            logs.append(log)
    if logs:
        _notify_grouped(workspace_id=event.workspace_id, logs=logs)
    return logs


def audit_autopilot_job(job):
    details = dict(job.result) if isinstance(job.result, dict) else {}
    details.setdefault('source', 'ai')
    log = _create_log(
        workspace=job.workspace,
        chat=job.chat,
        message=job.trigger_message,
        action_type=AutomationActionType.AUTOPILOT_REPLY,
        trigger='autopilot',
        correlation_id=job.id,
        raw_message=job.trigger_message.text,
        ai_prompt=_sources_prompt(job.sources),
        ai_response={'sources': job.sources, 'result': job.result},
        details=details,
        confidence=details.get('confidence'),
    )
    if log is not None:
        _notify_grouped(workspace_id=job.workspace_id, logs=[log])
    return log


def audit_automation_failure(*, event, error_text, failure_type):
    log = _create_log(
        workspace=event.workspace,
        chat=event.chat,
        message=event.message,
        action_type='automation_failure',
        trigger=event.event_type,
        correlation_id=event.id,
        raw_message=event.message.text,
        ai_response=event.analysis,
        details={
            'status': 'failed',
            'failure_type': failure_type,
            'error': error_text,
        },
    )
    if log is not None:
        _notify_grouped(workspace_id=event.workspace_id, logs=[log])
    return log


def _create_log(
    *,
    workspace,
    chat,
    message,
    action_type,
    trigger,
    correlation_id,
    raw_message,
    details,
    ai_prompt='',
    ai_response=None,
    ip=None,
    user_agent='',
    confidence=None,
):
    action = _audit_action(action_type, details)
    user = _workspace_actor_user(workspace)
    log, created = AIAutomationAuditLog.objects.get_or_create(
        workspace=workspace,
        correlation_id=correlation_id,
        action_type=action_type,
        defaults={
            'user': user,
            'action': action,
            'trigger': trigger[:64],
            'chat': chat,
            'message': message,
            'raw_message': (raw_message or '')[:1000],
            'ai_prompt': (ai_prompt or '')[:2000],
            'ai_response': _json_safe(ai_response or {}),
            'ip': ip,
            'user_agent': (user_agent or '')[:512],
            'confidence': confidence,
            'details': _json_safe(details),
        },
    )
    return log if created else None


def _audit_action(action_type, details):
    status = details.get('status')
    reason = details.get('reason') or status
    if status in {'created', 'updated', 'sent'}:
        return ACTION_BY_SUCCESS.get(
            action_type,
            AIAutomationAuditAction.AI_DECISION_SKIPPED,
        )
    if status == 'failed':
        return AIAutomationAuditAction.AI_ACTION_FAILED
    if reason in LIMIT_REASONS:
        return AIAutomationAuditAction.AI_LIMIT_REACHED
    return AIAutomationAuditAction.AI_DECISION_SKIPPED


def _confidence_for_action(analysis, action_type):
    if not isinstance(analysis, dict):
        return None
    section = {}
    if action_type == AutomationActionType.CONTACT_ENRICHMENT:
        section = analysis.get('contact') or {}
    elif action_type in {
        AutomationActionType.DEAL_CREATE,
        AutomationActionType.DEAL_ENRICHMENT,
    }:
        section = analysis.get('deal') or {}
    elif action_type == AutomationActionType.TASK_CREATE:
        section = analysis.get('task') or {}
    elif action_type == AutomationActionType.INSIGHT:
        section = analysis.get('insight') or {}
    if not isinstance(section, dict):
        return None
    value = section.get('interest_confidence', section.get('confidence'))
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, number))


def _notify_grouped(*, workspace_id, logs):
    _create_persistent_notifications(logs)
    payload = {
        'event': 'ai_actions_notification',
        'correlation_id': str(logs[0].correlation_id),
        'items': [
            {
                'id': str(log.id),
                'action': log.action,
                'action_type': log.action_type,
                'details': log.details,
                'chat_id': str(log.chat_id) if log.chat_id else None,
                'message_id': str(log.message_id) if log.message_id else None,
                'created_at': log.created_at.isoformat(),
            }
            for log in logs
        ],
    }
    transaction.on_commit(lambda: broadcast_workspace_event(workspace_id, payload))


def _create_persistent_notifications(logs):
    users = list(_notification_users(logs[0].workspace_id))
    if not users:
        return
    entries = [
        (log, payload)
        for log in logs
        if (payload := _notification_for_log(log)) is not None
    ]
    if any(
        log.action == AIAutomationAuditAction.AI_CONTACT_CREATED
        for log, _ in entries
    ):
        entries = [
            entry
            for entry in entries
            if entry[0].action != AIAutomationAuditAction.AI_CONTACT_UPDATED
        ]
    if not entries:
        return
    if len(entries) > 1:
        payload = _grouped_notification(entries)
        for user in users:
            create_notification(user=user, **payload)
        return
    payload = entries[0][1]
    for user in users:
        create_notification(user=user, **payload)


def _grouped_notification(entries):
    logs = [entry[0] for entry in entries]
    labels = [_grouped_action_label(log.action) for log in logs]
    chat_id = next((str(log.chat_id) for log in logs if log.chat_id), '')
    correlation_id = str(logs[0].correlation_id)
    return {
        'type': NotificationType.AI_ACTIONS_GROUPED,
        'title': 'AI обработал переписку',
        'content': 'AI обработал переписку:\n' + '\n'.join(
            f'• {label}' for label in labels
        ),
        'link': f'/chat/{chat_id}' if chat_id else '',
        'entity_type': 'ai_actions',
        'entity_id': correlation_id,
    }


def _grouped_action_label(action):
    return {
        AIAutomationAuditAction.AI_CONTACT_CREATED: 'создан контакт',
        AIAutomationAuditAction.AI_CONTACT_UPDATED: 'обновлён контакт',
        AIAutomationAuditAction.AI_DEAL_CREATED: 'создана сделка',
        AIAutomationAuditAction.AI_DEAL_UPDATED: 'обновлена сделка',
        AIAutomationAuditAction.AI_TASK_CREATED: 'создана задача',
        AIAutomationAuditAction.AI_INSIGHTS_EXTRACTED: 'извлечена аналитика',
        AIAutomationAuditAction.AI_AUTOPILOT_SENT: 'отправлен ответ клиенту',
        AIAutomationAuditAction.AI_LIMIT_REACHED: 'достигнут лимит',
        AIAutomationAuditAction.AI_ACTION_FAILED: 'действие завершилось ошибкой',
    }[action]


def _notification_for_log(log):
    notification_type = NOTIFICATION_BY_ACTION.get(log.action)
    if notification_type is None:
        return None
    entity_type, entity_id = _notification_entity(log)
    link = _notification_link(entity_type, entity_id)
    title = _notification_title(log.action)
    content = _notification_content(log, entity_type=entity_type)
    return {
        'type': notification_type,
        'title': title,
        'content': content,
        'link': link,
        'entity_type': entity_type,
        'entity_id': entity_id,
    }


def _notification_entity(log):
    details = log.details if isinstance(log.details, dict) else {}
    if log.action in {
        AIAutomationAuditAction.AI_CONTACT_CREATED,
        AIAutomationAuditAction.AI_CONTACT_UPDATED,
    }:
        contact_id = details.get('contact_id') or getattr(log.chat, 'contact_id', None)
        return 'contact', str(contact_id) if contact_id else ''
    if log.action in {
        AIAutomationAuditAction.AI_DEAL_CREATED,
        AIAutomationAuditAction.AI_DEAL_UPDATED,
    }:
        return 'deal', str(details.get('deal_id') or '')
    if log.action == AIAutomationAuditAction.AI_TASK_CREATED:
        return 'task', str(details.get('task_id') or '')
    if log.action in {
        AIAutomationAuditAction.AI_INSIGHTS_EXTRACTED,
        AIAutomationAuditAction.AI_AUTOPILOT_SENT,
        AIAutomationAuditAction.AI_LIMIT_REACHED,
        AIAutomationAuditAction.AI_ACTION_FAILED,
    }:
        return 'chat', str(log.chat_id) if log.chat_id else ''
    return '', ''


def _notification_link(entity_type, entity_id):
    if not entity_type or not entity_id:
        return ''
    if entity_type == 'chat':
        return f'/chat/{entity_id}'
    return f'/{entity_type}s/{entity_id}'


def _notification_title(action):
    return {
        AIAutomationAuditAction.AI_CONTACT_CREATED: 'AI создал контакт',
        AIAutomationAuditAction.AI_CONTACT_UPDATED: 'AI обновил контакт',
        AIAutomationAuditAction.AI_DEAL_CREATED: 'AI создал сделку',
        AIAutomationAuditAction.AI_DEAL_UPDATED: 'AI обновил сделку',
        AIAutomationAuditAction.AI_TASK_CREATED: 'AI создал задачу',
        AIAutomationAuditAction.AI_INSIGHTS_EXTRACTED: 'AI нашёл инсайт',
        AIAutomationAuditAction.AI_AUTOPILOT_SENT: 'Автопилот ответил клиенту',
        AIAutomationAuditAction.AI_LIMIT_REACHED: 'AI достиг лимита',
        AIAutomationAuditAction.AI_ACTION_FAILED: 'Ошибка AI-действия',
    }[action]


def _notification_content(log, *, entity_type):
    details = log.details if isinstance(log.details, dict) else {}
    contact_name = ''
    if log.chat_id and getattr(log.chat, 'contact', None) is not None:
        contact_name = log.chat.contact.name
    if not contact_name:
        contact_name = 'клиента'

    if log.action == AIAutomationAuditAction.AI_TASK_CREATED:
        return f'AI создал задачу по переписке с {contact_name}.'
    if log.action == AIAutomationAuditAction.AI_DEAL_CREATED:
        return f'AI создал сделку по переписке с {contact_name}.'
    if log.action == AIAutomationAuditAction.AI_CONTACT_UPDATED:
        fields = details.get('fields') or []
        if fields:
            return f'AI обновил данные контакта: {", ".join(fields)[:120]}.'
        return f'AI обновил данные контакта {contact_name}.'
    if log.action == AIAutomationAuditAction.AI_DEAL_UPDATED:
        fields = details.get('fields') or []
        if fields:
            return f'AI обновил сделку: {", ".join(fields)[:120]}.'
        return f'AI обновил сделку по переписке с {contact_name}.'
    if log.action == AIAutomationAuditAction.AI_INSIGHTS_EXTRACTED:
        return f'AI обнаружил важную информацию в переписке с {contact_name}.'
    if log.action == AIAutomationAuditAction.AI_AUTOPILOT_SENT:
        return f'Автопилот отправил ответ клиенту {contact_name}.'
    if log.action == AIAutomationAuditAction.AI_LIMIT_REACHED:
        reason = details.get('reason') or details.get('status') or 'limit'
        return f'AI не выполнил действие из-за лимита: {reason}.'
    if log.action == AIAutomationAuditAction.AI_ACTION_FAILED:
        if log.action_type == AutomationActionType.AUTOPILOT_REPLY:
            return 'Клиент ожидает ответа, AI не смог помочь.'
        error = details.get('error') or 'неизвестная ошибка'
        return f'AI-действие завершилось ошибкой: {str(error)[:160]}.'
    return f'AI выполнил действие для {entity_type or "CRM"}.'


def _notification_users(workspace_id):
    return User.objects.filter(
        workspace_id=workspace_id,
        is_active=True,
        is_deleted=False,
    ).order_by('created_at', 'id')


def _workspace_actor_user(workspace):
    return (
        User.objects.filter(
            workspace=workspace,
            is_active=True,
            is_deleted=False,
        )
        .order_by('created_at', 'id')
        .first()
    )


def _sources_prompt(sources):
    if not sources:
        return ''
    return json.dumps(sources, ensure_ascii=False, default=str)[:2000]


def _json_safe(value):
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))
