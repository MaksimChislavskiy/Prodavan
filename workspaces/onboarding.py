import ipaddress
import uuid

from django.apps import apps
from django.db import transaction
from django.utils import timezone

from messaging.realtime import broadcast_workspace_event

from .models import (
    OnboardingAuditEvent,
    Workspace,
    WorkspaceOnboarding,
    WorkspaceOnboardingAuditLog,
)


ONBOARDING_CONTRACT_VERSION = 1
UPLOAD_AUDIT_EVENTS = {
    OnboardingAuditEvent.UPLOAD_STARTED,
    OnboardingAuditEvent.UPLOAD_SUCCESS,
    OnboardingAuditEvent.UPLOAD_FAILED,
}
MATERIAL_AUDIT_EVENTS = {
    'video': OnboardingAuditEvent.VIDEO_OPENED,
    'pdf': OnboardingAuditEvent.PDF_OPENED,
}


def request_audit_context(request):
    correlation_id = str(
        getattr(request, 'request_id', None) or uuid.uuid4(),
    )[:64]
    # Nginx overwrites X-Real-IP with the direct client address before proxying
    # to the private backend network. REMOTE_ADDR therefore normally contains
    # the proxy/container address in deployed environments.
    raw_ip = (
        request.META.get('HTTP_X_REAL_IP')
        or request.META.get('REMOTE_ADDR')
        or ''
    )
    try:
        ip_address = str(ipaddress.ip_address(raw_ip)) if raw_ip else None
    except ValueError:
        ip_address = None
    return {
        'correlation_id': correlation_id,
        'ip_address': ip_address,
        'user_agent': request.META.get('HTTP_USER_AGENT', '')[:512],
    }


def _has_ready_document(workspace_id):
    knowledge_document = apps.get_model('ai_assistant', 'KnowledgeDocument')
    return knowledge_document.objects.filter(
        workspace_id=workspace_id,
        status='ready',
        is_deleted=False,
    ).exists()


def _locked_state(workspace_id):
    Workspace.objects.select_for_update().only('id').get(id=workspace_id)
    state, _ = WorkspaceOnboarding.objects.get_or_create(
        workspace_id=workspace_id,
    )
    return state


def _status_payload(state, knowledge_base_completed):
    if state.completed:
        status_name = 'completed'
        knowledge_base_completed = True
        materials_viewed = True
    else:
        materials_viewed = state.materials_viewed
        status_name = (
            'in_progress'
            if knowledge_base_completed or materials_viewed
            else 'not_started'
        )
    completed_at = state.completed_at
    return {
        'version': ONBOARDING_CONTRACT_VERSION,
        'status': status_name,
        'completed_at': (
            completed_at.isoformat().replace('+00:00', 'Z')
            if completed_at
            else None
        ),
        'steps': {
            'knowledge_base_completed': knowledge_base_completed,
            'materials_viewed': materials_viewed,
        },
    }


def _write_audit(
    *,
    workspace_id,
    user_id,
    event,
    details,
    correlation_id,
    ip_address=None,
    user_agent='',
):
    WorkspaceOnboardingAuditLog.objects.create(
        workspace_id=workspace_id,
        workspace_identifier=workspace_id,
        user_id=user_id,
        user_identifier=user_id,
        event=event,
        details=details,
        ip=ip_address,
        user_agent=user_agent,
        correlation_id=str(correlation_id or uuid.uuid4())[:64],
    )


def _broadcast_status(workspace_id, payload, correlation_id):
    event = {
        'event': 'onboarding_status_updated',
        'correlation_id': str(correlation_id or uuid.uuid4())[:64],
        'data': payload,
    }
    transaction.on_commit(
        lambda: broadcast_workspace_event(workspace_id, event),
        robust=True,
    )


def _complete_if_ready(
    state,
    *,
    knowledge_base_completed,
    user_id,
    correlation_id,
    ip_address=None,
    user_agent='',
    trigger_document_id=None,
):
    if (
        state.completed
        or not knowledge_base_completed
        or not state.materials_viewed
    ):
        return False
    state.completed = True
    state.completed_at = timezone.now()
    state.save(update_fields=('completed', 'completed_at', 'updated_at'))
    details = {
        'reason': {
            'steps': {
                'knowledge_base_completed': True,
                'materials_viewed': True,
            },
        },
    }
    if trigger_document_id is not None:
        details['reason']['trigger_document_id'] = str(trigger_document_id)
    _write_audit(
        workspace_id=state.workspace_id,
        user_id=user_id,
        event=OnboardingAuditEvent.COMPLETED,
        details=details,
        correlation_id=correlation_id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    return True


def get_onboarding_status(
    *,
    workspace_id,
    user_id,
    correlation_id,
    ip_address=None,
    user_agent='',
):
    with transaction.atomic():
        state = _locked_state(workspace_id)
        knowledge_base_completed = _has_ready_document(workspace_id)
        completed_now = _complete_if_ready(
            state,
            knowledge_base_completed=knowledge_base_completed,
            user_id=user_id,
            correlation_id=correlation_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        payload = _status_payload(state, knowledge_base_completed)
        if completed_now:
            _broadcast_status(workspace_id, payload, correlation_id)
    return payload


def mark_materials_viewed(
    *,
    workspace_id,
    user_id,
    correlation_id,
    ip_address=None,
    user_agent='',
    material=None,
):
    with transaction.atomic():
        state = _locked_state(workspace_id)
        knowledge_base_completed = _has_ready_document(workspace_id)
        before = _status_payload(state, knowledge_base_completed)

        material_event = MATERIAL_AUDIT_EVENTS.get(material)
        if material_event is not None and not state.completed:
            _write_audit(
                workspace_id=workspace_id,
                user_id=user_id,
                event=material_event,
                details={},
                correlation_id=correlation_id,
                ip_address=ip_address,
                user_agent=user_agent,
            )

        if not state.completed and not state.materials_viewed:
            state.materials_viewed = True
            state.save(update_fields=('materials_viewed', 'updated_at'))
            _write_audit(
                workspace_id=workspace_id,
                user_id=user_id,
                event=OnboardingAuditEvent.MATERIALS_VIEWED,
                details={},
                correlation_id=correlation_id,
                ip_address=ip_address,
                user_agent=user_agent,
            )
        _complete_if_ready(
            state,
            knowledge_base_completed=knowledge_base_completed,
            user_id=user_id,
            correlation_id=correlation_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        payload = _status_payload(state, knowledge_base_completed)
        if payload != before:
            _broadcast_status(workspace_id, payload, correlation_id)
    return payload


def onboarding_knowledge_state_changed(
    *,
    workspace_id,
    previous_has_ready,
    current_has_ready,
    user_id=None,
    correlation_id=None,
    trigger_document_id=None,
):
    if previous_has_ready == current_has_ready:
        return
    correlation_id = str(
        correlation_id or trigger_document_id or uuid.uuid4(),
    )[:64]
    with transaction.atomic():
        state = _locked_state(workspace_id)
        if state.completed:
            return
        before = _status_payload(state, previous_has_ready)
        _complete_if_ready(
            state,
            knowledge_base_completed=current_has_ready,
            user_id=user_id,
            correlation_id=correlation_id,
            trigger_document_id=trigger_document_id,
        )
        payload = _status_payload(state, current_has_ready)
        if payload != before:
            _broadcast_status(workspace_id, payload, correlation_id)


def record_onboarding_upload_event(
    *,
    workspace_id,
    user_id,
    event,
    details,
    correlation_id,
    ip_address=None,
    user_agent='',
):
    if event not in UPLOAD_AUDIT_EVENTS:
        raise ValueError('Недопустимое событие загрузки онбординга.')
    if WorkspaceOnboarding.objects.filter(
        workspace_id=workspace_id,
        completed=True,
    ).exists():
        return
    _write_audit(
        workspace_id=workspace_id,
        user_id=user_id,
        event=event,
        details=details,
        correlation_id=correlation_id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
