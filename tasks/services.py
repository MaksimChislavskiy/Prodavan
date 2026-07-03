import hashlib
import json
import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.renderers import JSONRenderer

from contacts.models import Contact
from deals.models import Deal
from messaging.realtime import broadcast_workspace_event

from .dates import canonicalize_due_date
from .models import (
    DueDateType,
    Task,
    TaskAuditLog,
    TaskEvent,
    TaskHistory,
    TaskIdempotencyRecord,
    TaskSource,
    TaskStatus,
)
from .serializers import TaskDetailSerializer


class TaskServiceError(Exception):
    def __init__(self, code, message, status_code, **extra):
        self.status_code = status_code
        if code in {'version_conflict', 'idempotency_key_reused'}:
            self.response_data = {'error': code, **extra}
            if code == 'idempotency_key_reused':
                self.response_data['message'] = message
        else:
            self.response_data = {'error': {'code': code, 'message': message, **extra}}
        super().__init__(message)


def request_audit_context(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    ip_address = forwarded.split(',', 1)[0].strip() if forwarded else None
    if ip_address is None:
        ip_address = request.META.get('REMOTE_ADDR')
    return {
        'ip_address': ip_address,
        'user_agent': request.META.get('HTTP_USER_AGENT', '')[:2000],
    }


def _request_hash(data):
    payload = json.dumps(data, sort_keys=True, default=str, separators=(',', ':'))
    return hashlib.sha256(payload.encode()).hexdigest()


def _json_data(data):
    return json.loads(JSONRenderer().render(data))


def _value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _broadcast(workspace_id, payload):
    transaction.on_commit(lambda: broadcast_workspace_event(workspace_id, payload))


def _record_event(
    *,
    task,
    event,
    source,
    user=None,
    data=None,
    changes=None,
    context=None,
    correlation_id=None,
):
    context = context or {}
    correlation_id = correlation_id or uuid.uuid4()
    TaskHistory.objects.create(
        workspace=task.workspace,
        task=task,
        event=event,
        source=source,
        user=user,
        data=data or {},
        changes=changes or {},
        ip_address=context.get('ip_address'),
        user_agent=context.get('user_agent', ''),
        correlation_id=correlation_id,
    )
    TaskAuditLog.objects.create(
        workspace=task.workspace,
        task_identifier=task.id,
        event=event,
        source=source,
        user=user,
        details={'data': data or {}, 'changes': changes or {}},
        ip_address=context.get('ip_address'),
        user_agent=context.get('user_agent', ''),
        correlation_id=correlation_id,
    )
    return correlation_id


def _resolve_contact(workspace, contact_id):
    if contact_id is None:
        return None
    contact = Contact.objects.filter(
        id=contact_id,
        workspace=workspace,
        is_deleted=False,
    ).first()
    if contact is None:
        raise TaskServiceError(
            'CONTACT_NOT_FOUND',
            'Контакт не найден.',
            status.HTTP_400_BAD_REQUEST,
        )
    return contact


def _resolve_deal(workspace, deal_id):
    if deal_id is None:
        return None
    deal = Deal.objects.filter(
        id=deal_id,
        workspace=workspace,
        is_deleted=False,
    ).first()
    if deal is None:
        raise TaskServiceError(
            'DEAL_NOT_FOUND',
            'Сделка не найдена.',
            status.HTTP_400_BAD_REQUEST,
        )
    return deal


def _validate_relations(contact, deal):
    if contact is not None and deal is not None and deal.contact_id != contact.id:
        raise TaskServiceError(
            'RELATION_MISMATCH',
            'Выбранная сделка не связана с указанным контактом.',
            status.HTTP_400_BAD_REQUEST,
        )


def _validate_due_date(due_date_type, due_date):
    if due_date_type == DueDateType.NONE and due_date is not None:
        raise TaskServiceError(
            'INVALID_DUE_DATE',
            'Для задачи без срока due_date должен быть null.',
            status.HTTP_400_BAD_REQUEST,
        )
    if due_date_type != DueDateType.NONE and due_date is None:
        raise TaskServiceError(
            'INVALID_DUE_DATE',
            'Дата выполнения обязательна для выбранного типа срока.',
            status.HTTP_400_BAD_REQUEST,
        )


def create_task(
    *,
    workspace,
    user,
    data,
    idempotency_key,
    source=TaskSource.USER,
    audit_context=None,
):
    data = dict(data)
    data['due_date'] = canonicalize_due_date(
        data.get('due_date_type', DueDateType.NONE),
        data.get('due_date'),
        workspace=workspace,
    )
    request_hash = _request_hash(data)
    existing = TaskIdempotencyRecord.objects.filter(
        workspace=workspace,
        key=idempotency_key,
        expires_at__gt=timezone.now(),
    ).first()
    if existing is not None:
        if existing.request_hash != request_hash:
            raise TaskServiceError(
                'idempotency_key_reused',
                'Idempotency-Key already used with different payload',
                status.HTTP_409_CONFLICT,
            )
        return existing.response_body, status.HTTP_200_OK

    with transaction.atomic():
        contact = _resolve_contact(workspace, data.get('contact_id'))
        deal = _resolve_deal(workspace, data.get('deal_id'))
        _validate_relations(contact, deal)
        due_date_type = data.get('due_date_type', DueDateType.NONE)
        due_date = data.get('due_date')
        _validate_due_date(due_date_type, due_date)
        task = Task.objects.create(
            workspace=workspace,
            title=data['title'],
            description=data.get('description'),
            due_date=due_date,
            due_date_type=due_date_type,
            contact=contact,
            deal=deal,
            comment=data.get('comment'),
            status=TaskStatus.NEW,
            created_by_ai=source == TaskSource.AI,
            created_by_user=user if source == TaskSource.USER else None,
        )
        correlation_id = _record_event(
            task=task,
            event=TaskEvent.CREATED,
            source=source,
            user=user if source == TaskSource.USER else None,
            data={'title': task.title},
            context=audit_context,
        )
        body = TaskDetailSerializer(task).data
        TaskIdempotencyRecord.objects.filter(
            workspace=workspace,
            key=idempotency_key,
            expires_at__lte=timezone.now(),
        ).delete()
        TaskIdempotencyRecord.objects.create(
            workspace=workspace,
            key=idempotency_key,
            request_hash=request_hash,
            response_body=_json_data(body),
            expires_at=timezone.now() + timedelta(hours=24),
        )
        _broadcast(
            workspace.id,
            {
                'event': 'task_created',
                'task': _json_data(body),
                'correlation_id': str(correlation_id),
            },
        )
    return body, status.HTTP_201_CREATED


def update_task(
    *,
    workspace,
    user,
    task_id,
    submitted_version,
    data,
    audit_context=None,
):
    with transaction.atomic():
        task = Task.objects.select_for_update().select_related(
            'workspace', 'contact', 'deal',
        ).filter(
            id=task_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if task is None:
            raise TaskServiceError(
                'TASK_NOT_FOUND', 'Задача не найдена.', status.HTTP_404_NOT_FOUND,
            )
        if task.version != submitted_version:
            raise TaskServiceError(
                'version_conflict',
                'Задача была изменена другим пользователем.',
                status.HTTP_409_CONFLICT,
                current_version=task.version,
            )

        contact = task.contact
        deal = task.deal
        if 'contact_id' in data:
            contact = _resolve_contact(workspace, data['contact_id'])
        if 'deal_id' in data:
            deal = _resolve_deal(workspace, data['deal_id'])
        _validate_relations(contact, deal)
        due_date_type = data.get('due_date_type', task.due_date_type)
        due_date = data.get('due_date', task.due_date)
        due_date = canonicalize_due_date(
            due_date_type,
            due_date,
            workspace=workspace,
        )
        _validate_due_date(due_date_type, due_date)

        proposed = {
            'title': data.get('title', task.title),
            'description': data.get('description', task.description),
            'due_date': due_date,
            'due_date_type': due_date_type,
            'contact_id': contact.id if contact else None,
            'deal_id': deal.id if deal else None,
            'comment': data.get('comment', task.comment),
        }
        changes = {}
        for field, new_value in proposed.items():
            old_value = getattr(task, field)
            if old_value != new_value:
                changes[field] = {'old': _value(old_value), 'new': _value(new_value)}
        if not changes:
            return TaskDetailSerializer(task).data

        task.title = proposed['title']
        task.description = proposed['description']
        task.due_date = proposed['due_date']
        task.due_date_type = proposed['due_date_type']
        task.contact = contact
        task.deal = deal
        task.comment = proposed['comment']
        task.version += 1
        task.save(update_fields=(
            'title', 'description', 'due_date', 'due_date_type', 'contact',
            'deal', 'comment', 'version', 'updated_at',
        ))
        correlation_id = _record_event(
            task=task,
            event=TaskEvent.UPDATED,
            source=TaskSource.USER,
            user=user,
            changes=changes,
            context=audit_context,
        )
        body = TaskDetailSerializer(task).data
        _broadcast(
            workspace.id,
            {
                'event': 'task_updated',
                'task': _json_data(body),
                'correlation_id': str(correlation_id),
            },
        )
    return body


def update_task_status(
    *, workspace, user, task_id, submitted_version, new_status, audit_context=None,
):
    with transaction.atomic():
        task = Task.objects.select_for_update().select_related(
            'workspace', 'contact', 'deal',
        ).filter(
            id=task_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if task is None:
            raise TaskServiceError(
                'TASK_NOT_FOUND', 'Задача не найдена.', status.HTTP_404_NOT_FOUND,
            )
        if task.version != submitted_version:
            raise TaskServiceError(
                'version_conflict',
                'Задача была изменена другим пользователем.',
                status.HTTP_409_CONFLICT,
                current_version=task.version,
            )
        if task.status == new_status:
            return TaskDetailSerializer(task).data
        old_status = task.status
        task.status = new_status
        task.version += 1
        task.save(update_fields=('status', 'version', 'updated_at'))
        correlation_id = _record_event(
            task=task,
            event=TaskEvent.UPDATED,
            source=TaskSource.USER,
            user=user,
            changes={'status': {'old': old_status, 'new': new_status}},
            context=audit_context,
        )
        body = TaskDetailSerializer(task).data
        _broadcast(
            workspace.id,
            {
                'event': 'task_updated',
                'task': _json_data(body),
                'correlation_id': str(correlation_id),
            },
        )
    return body


def delete_task(*, workspace, user, task_id, audit_context=None):
    with transaction.atomic():
        task = Task.objects.select_for_update().filter(
            id=task_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if task is None:
            raise TaskServiceError(
                'TASK_NOT_FOUND', 'Задача не найдена.', status.HTTP_404_NOT_FOUND,
            )
        task.is_deleted = True
        task.deleted_at = timezone.now()
        task.version += 1
        task.save(update_fields=('is_deleted', 'deleted_at', 'version', 'updated_at'))
        correlation_id = _record_event(
            task=task,
            event=TaskEvent.DELETED,
            source=TaskSource.USER,
            user=user,
            context=audit_context,
        )
        _broadcast(
            workspace.id,
            {
                'event': 'task_deleted',
                'task_id': str(task.id),
                'correlation_id': str(correlation_id),
            },
        )


def bulk_delete_tasks(*, workspace, user, task_ids, audit_context=None):
    with transaction.atomic():
        found = {
            task.id: task
            for task in Task.objects.select_for_update().filter(
                workspace=workspace,
                id__in=task_ids,
            )
        }
        deleted_ids = []
        skipped_ids = []
        correlation_id = uuid.uuid4()
        now = timezone.now()
        for task_id in task_ids:
            task = found.get(task_id)
            if task is None:
                skipped_ids.append({'id': str(task_id), 'reason': 'not_found'})
                continue
            if task.is_deleted:
                skipped_ids.append({'id': str(task_id), 'reason': 'already_deleted'})
                continue
            task.is_deleted = True
            task.deleted_at = now
            task.version += 1
            task.save(update_fields=('is_deleted', 'deleted_at', 'version', 'updated_at'))
            deleted_ids.append(str(task.id))
            _record_event(
                task=task,
                event=TaskEvent.DELETED,
                source=TaskSource.USER,
                user=user,
                context=audit_context,
                correlation_id=correlation_id,
            )
        context = audit_context or {}
        TaskAuditLog.objects.create(
            workspace=workspace,
            event=TaskEvent.BULK_DELETED,
            source=TaskSource.USER,
            user=user,
            details={
                'deleted_count': len(deleted_ids),
                'skipped_count': len(skipped_ids),
                'first_10_ids': deleted_ids[:10],
            },
            ip_address=context.get('ip_address'),
            user_agent=context.get('user_agent', ''),
            correlation_id=correlation_id,
        )
        if deleted_ids:
            _broadcast(
                workspace.id,
                {
                    'event': 'tasks_bulk_deleted',
                    'deleted_ids': deleted_ids,
                    'skipped_count': len(skipped_ids),
                    'correlation_id': str(correlation_id),
                },
            )
    return {'deleted_count': len(deleted_ids), 'skipped_ids': skipped_ids}


def _detach_related_tasks(*, workspace, field, object_ids):
    if not object_ids:
        return
    lookup = {f'{field}_id__in': object_ids}
    tasks = list(Task.objects.select_for_update().select_related(
        'workspace', 'contact', 'deal',
    ).filter(workspace=workspace, is_deleted=False, **lookup))
    for task in tasks:
        old_id = getattr(task, f'{field}_id')
        setattr(task, field, None)
        task.version += 1
        task.save(update_fields=(field, 'version', 'updated_at'))
        changes = {f'{field}_id': {'old': str(old_id), 'new': None}}
        correlation_id = _record_event(
            task=task,
            event=TaskEvent.UPDATED,
            source=TaskSource.SYSTEM,
            changes=changes,
        )
        body = TaskDetailSerializer(task).data
        _broadcast(
            workspace.id,
            {
                'event': 'task_updated',
                'task': _json_data(body),
                'correlation_id': str(correlation_id),
            },
        )


def detach_tasks_for_contacts(*, workspace, contact_ids):
    _detach_related_tasks(
        workspace=workspace,
        field='contact',
        object_ids=contact_ids,
    )


def detach_tasks_for_deals(*, workspace, deal_ids):
    _detach_related_tasks(
        workspace=workspace,
        field='deal',
        object_ids=deal_ids,
    )
