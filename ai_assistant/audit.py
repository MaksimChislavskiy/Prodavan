import json

from django.db import transaction

from messaging.realtime import broadcast_workspace_event
from users.models import User

from .models import (
    AIAutomationAuditAction,
    AIAutomationAuditLog,
    AutomationActionType,
)


LIMIT_REASONS = {
    'skipped_daily_limit',
    'skipped_chat_limit',
    'workspace_daily_reply_limit',
    'chat_hourly_limit',
    'consecutive_reply_limit',
}


ACTION_BY_SUCCESS = {
    AutomationActionType.CONTACT_ENRICHMENT: AIAutomationAuditAction.AI_CONTACT_UPDATED,
    AutomationActionType.DEAL_CREATE: AIAutomationAuditAction.AI_DEAL_CREATED,
    AutomationActionType.DEAL_ENRICHMENT: AIAutomationAuditAction.AI_DEAL_UPDATED,
    AutomationActionType.TASK_CREATE: AIAutomationAuditAction.AI_TASK_CREATED,
    AutomationActionType.INSIGHT: AIAutomationAuditAction.AI_INSIGHTS_EXTRACTED,
    AutomationActionType.AUTOPILOT_REPLY: AIAutomationAuditAction.AI_AUTOPILOT_SENT,
}


def audit_automation_event(*, event, analysis, action_results):
    logs = []
    for action_type, result in action_results.items():
        if not isinstance(result, dict) or result.get('status') == 'already_processed':
            continue
        log = _create_log(
            workspace=event.workspace,
            chat=event.chat,
            message=event.message,
            action_type=action_type,
            trigger=event.event_type,
            correlation_id=event.id,
            raw_message=event.message.text,
            ai_response=analysis,
            confidence=_confidence_for_action(analysis, action_type),
            details=result,
        )
        if log is not None:
            logs.append(log)
    if logs:
        _notify_grouped(workspace_id=event.workspace_id, logs=logs)
    return logs


def audit_autopilot_job(job):
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
        details=job.result,
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
    if not isinstance(section, dict):
        return None
    value = section.get('interest_confidence', section.get('confidence'))
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, number))


def _notify_grouped(*, workspace_id, logs):
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
