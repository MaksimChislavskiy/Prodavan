import hashlib
import json
import uuid
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import status
from rest_framework.renderers import JSONRenderer

from contacts.models import Contact
from messaging.realtime import broadcast_workspace_event

from .models import (
    ChangedByType,
    Deal,
    DealEvent,
    DealHistory,
    DealIdempotencyRecord,
    SalesStage,
)
from .serializers import DealDetailSerializer, DealListSerializer, StageReadSerializer


class CRMServiceError(Exception):
    def __init__(self, code, message, status_code, **extra):
        self.status_code = status_code
        self.response_data = {'error': {'code': code, 'message': message, **extra}}
        super().__init__(message)


def _not_found(message='Сделка не найдена.'):
    return CRMServiceError('DEAL_NOT_FOUND', message, status.HTTP_404_NOT_FOUND)


def _request_hash(data):
    payload = json.dumps(data, sort_keys=True, default=str, separators=(',', ':'))
    return hashlib.sha256(payload.encode()).hexdigest()


def _json_data(data):
    return json.loads(JSONRenderer().render(data))


def _event(workspace_id, event, correlation_id, **data):
    payload = {'event': event, 'correlation_id': str(correlation_id), **data}
    transaction.on_commit(
        lambda: broadcast_workspace_event(workspace_id, payload),
    )


def _record_history(**kwargs):
    history = DealHistory.objects.create(**kwargs)
    previous = (
        DealHistory.objects.filter(deal=history.deal)
        .exclude(id=history.id)
        .order_by('-created_at')
        .first()
    )
    if previous is not None and history.created_at <= previous.created_at:
        history.created_at = previous.created_at + timedelta(microseconds=1)
        history.save(update_fields=('created_at',))
    return history


def _active_contact(workspace, contact_id, *, required=False):
    if contact_id is None:
        if required:
            raise CRMServiceError(
                'CONTACT_REQUIRED',
                'Для сохранения сделки необходимо выбрать контакт.',
                status.HTTP_400_BAD_REQUEST,
            )
        return None
    contact = Contact.objects.filter(
        id=contact_id,
        workspace=workspace,
        is_deleted=False,
    ).first()
    if contact is None:
        raise CRMServiceError(
            'CONTACT_NOT_FOUND',
            'Контакт не найден.',
            status.HTTP_400_BAD_REQUEST,
        )
    return contact


def _idempotent_result(workspace, operation, key, data):
    request_hash = _request_hash(data)
    record = DealIdempotencyRecord.objects.filter(
        workspace=workspace,
        operation=operation,
        key=key,
        expires_at__gt=timezone.now(),
    ).first()
    if record is None:
        return None, request_hash
    if record.request_hash != request_hash:
        raise CRMServiceError(
            'IDEMPOTENCY_KEY_REUSED',
            'Idempotency-Key уже использован с другим телом запроса.',
            status.HTTP_409_CONFLICT,
        )
    return (record.response_body, record.response_status), request_hash


def _save_idempotency(workspace, operation, key, request_hash, body, response_status):
    DealIdempotencyRecord.objects.filter(
        workspace=workspace,
        operation=operation,
        key=key,
        expires_at__lte=timezone.now(),
    ).delete()
    DealIdempotencyRecord.objects.create(
        workspace=workspace,
        operation=operation,
        key=key,
        request_hash=request_hash,
        response_body=_json_data(body),
        response_status=response_status,
        expires_at=timezone.now() + timedelta(hours=24),
    )


def create_deal(*, workspace, user, data, idempotency_key, changed_by_type=ChangedByType.USER):
    cached, request_hash = _idempotent_result(
        workspace, 'create', idempotency_key, data,
    )
    if cached is not None:
        return cached[0], status.HTTP_200_OK

    with transaction.atomic():
        stage = SalesStage.objects.select_for_update().get(
            workspace=workspace,
            is_system=True,
            is_deleted=False,
        )
        contact = _active_contact(workspace, data.get('contact_id'))
        deal = Deal.objects.create(
            workspace=workspace,
            stage=stage,
            contact=contact,
            name=data['name'],
            amount=data.get('amount'),
            currency=data.get('currency', 'RUB'),
            comment=data.get('comment'),
        )
        correlation_id = uuid.uuid4()
        _record_history(
            workspace=workspace,
            deal=deal,
            event_type=DealEvent.CREATED,
            changed_by_type=changed_by_type,
            changed_by=user if changed_by_type == ChangedByType.USER else None,
            changes={'source': changed_by_type},
            correlation_id=correlation_id,
        )
        body = DealListSerializer(deal).data
        _save_idempotency(
            workspace, 'create', idempotency_key, request_hash, body,
            status.HTTP_201_CREATED,
        )
        _event(
            workspace.id,
            'deal_created',
            correlation_id,
            deal_id=str(deal.id),
            stage_id=str(stage.id),
        )
    return body, status.HTTP_201_CREATED


def update_deal(
    *,
    workspace,
    user,
    deal_id,
    submitted_version,
    data,
    changed_by_type=ChangedByType.USER,
):
    with transaction.atomic():
        deal = Deal.objects.select_for_update().select_related('contact', 'stage').filter(
            id=deal_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if deal is None:
            raise _not_found()
        if deal.version != submitted_version:
            raise CRMServiceError(
                'VERSION_CONFLICT',
                'Сделка была изменена другим пользователем.',
                status.HTTP_409_CONFLICT,
                current_version=deal.version,
            )

        changes = {}
        if 'contact_id' in data:
            contact = _active_contact(workspace, data['contact_id'], required=True)
            if contact.id != deal.contact_id:
                changes['contact_id'] = {
                    'old': str(deal.contact_id) if deal.contact_id else None,
                    'new': str(contact.id),
                }
                deal.contact = contact
        elif deal.contact is None or deal.contact.is_deleted:
            raise CRMServiceError(
                'CONTACT_REQUIRED',
                'Для сохранения сделки необходимо выбрать контакт.',
                status.HTTP_400_BAD_REQUEST,
            )

        for field in ('name', 'amount', 'comment'):
            if field not in data:
                continue
            old_value = getattr(deal, field)
            new_value = data[field]
            if old_value != new_value:
                changes[field] = {
                    'old': str(old_value) if old_value is not None else None,
                    'new': str(new_value) if new_value is not None else None,
                }
                setattr(deal, field, new_value)

        if not changes:
            return DealDetailSerializer(deal).data

        deal.version += 1
        deal.save(update_fields=(
            'contact', 'name', 'amount', 'comment', 'version', 'updated_at',
        ))
        correlation_id = uuid.uuid4()
        _record_history(
            workspace=workspace,
            deal=deal,
            event_type=DealEvent.UPDATED,
            changed_by_type=changed_by_type,
            changed_by=user if changed_by_type == ChangedByType.USER else None,
            changes=changes,
            correlation_id=correlation_id,
        )
        _event(
            workspace.id,
            'deal_updated',
            correlation_id,
            deal_id=str(deal.id),
            stage_id=str(deal.stage_id),
        )
    return DealDetailSerializer(deal).data


def move_deal(*, workspace, user, deal_id, stage_id, submitted_version, idempotency_key=None):
    request_data = {
        'deal_id': str(deal_id),
        'stage_id': str(stage_id),
        'version': submitted_version,
    }
    if idempotency_key:
        cached, request_hash = _idempotent_result(
            workspace, 'move', idempotency_key, request_data,
        )
        if cached is not None:
            return cached[0]
    else:
        request_hash = None

    with transaction.atomic():
        deal = Deal.objects.select_for_update().select_related('contact', 'stage').filter(
            id=deal_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if deal is None:
            raise _not_found()
        if deal.version != submitted_version:
            raise CRMServiceError(
                'VERSION_CONFLICT',
                'Сделка была изменена другим пользователем.',
                status.HTTP_409_CONFLICT,
                current_version=deal.version,
            )
        stage = SalesStage.objects.filter(
            id=stage_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if stage is None:
            raise CRMServiceError(
                'STAGE_NOT_FOUND', 'Этап не найден.', status.HTTP_404_NOT_FOUND,
            )
        if deal.stage_id == stage.id:
            body = DealListSerializer(deal).data
        else:
            old_stage_id = deal.stage_id
            deal.stage = stage
            deal.version += 1
            deal.save(update_fields=('stage', 'version', 'updated_at'))
            correlation_id = uuid.uuid4()
            _record_history(
                workspace=workspace,
                deal=deal,
                event_type=DealEvent.STAGE_CHANGED,
                changed_by=user,
                changes={
                    'stage_id': {
                        'old': str(old_stage_id),
                        'new': str(stage.id),
                    },
                },
                correlation_id=correlation_id,
            )
            _event(
                workspace.id,
                'deal_stage_changed',
                correlation_id,
                deal_id=str(deal.id),
                from_stage_id=str(old_stage_id),
                to_stage_id=str(stage.id),
            )
            body = DealListSerializer(deal).data
        if idempotency_key:
            _save_idempotency(
                workspace, 'move', idempotency_key, request_hash, body,
                status.HTTP_200_OK,
            )
    return body


def delete_deal(*, workspace, user, deal_id):
    from tasks.services import detach_tasks_for_deals

    with transaction.atomic():
        deal = Deal.objects.select_for_update().filter(
            id=deal_id,
            workspace=workspace,
        ).first()
        if deal is None:
            raise _not_found()
        if deal.is_deleted:
            return
        deal.is_deleted = True
        deal.deleted_at = timezone.now()
        deal.version += 1
        deal.save(update_fields=('is_deleted', 'deleted_at', 'version', 'updated_at'))
        detach_tasks_for_deals(
            workspace=workspace,
            deal_ids=[deal.id],
        )
        correlation_id = uuid.uuid4()
        _record_history(
            workspace=workspace,
            deal=deal,
            event_type=DealEvent.DELETED,
            changed_by=user,
            correlation_id=correlation_id,
        )
        _event(
            workspace.id,
            'deal_deleted',
            correlation_id,
            deal_id=str(deal.id),
        )


def _validate_stage_name(workspace, name, exclude_id=None):
    queryset = SalesStage.objects.filter(
        workspace=workspace,
        is_deleted=False,
        name_normalized=name.strip().casefold(),
    )
    if exclude_id:
        queryset = queryset.exclude(id=exclude_id)
    if queryset.exists():
        raise CRMServiceError(
            'STAGE_NAME_EXISTS',
            'Этап с таким названием уже существует.',
            status.HTTP_400_BAD_REQUEST,
        )


def _reorder(workspace, ordered_stages):
    SalesStage.objects.filter(
        workspace=workspace,
        is_deleted=False,
    ).update(order=F('order') + 100)
    for index, stage in enumerate(ordered_stages, 1):
        SalesStage.objects.filter(id=stage.id).update(order=index)
        stage.order = index


def create_stage(*, workspace, data):
    with transaction.atomic():
        stages = list(SalesStage.objects.select_for_update().filter(
            workspace=workspace,
            is_deleted=False,
        ).order_by('order'))
        if len(stages) >= 20:
            raise CRMServiceError(
                'STAGE_LIMIT_REACHED',
                'Достигнуто максимальное количество этапов',
                status.HTTP_400_BAD_REQUEST,
            )
        _validate_stage_name(workspace, data['name'])
        stage = SalesStage.objects.create(
            workspace=workspace,
            name=data['name'],
            order=100 + len(stages) + 1,
        )
        position = min(data.get('order', len(stages) + 1), len(stages) + 1)
        position = max(position, 2)
        stages.insert(position - 1, stage)
        _reorder(workspace, stages)
        stage.refresh_from_db()
        correlation_id = uuid.uuid4()
        _event(
            workspace.id,
            'stage_created',
            correlation_id,
            stage=StageReadSerializer(stage).data,
        )
    return stage


def update_stage(*, workspace, stage_id, submitted_version, data):
    with transaction.atomic():
        stage = SalesStage.objects.select_for_update().filter(
            id=stage_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if stage is None:
            raise CRMServiceError(
                'STAGE_NOT_FOUND', 'Этап не найден.', status.HTTP_404_NOT_FOUND,
            )
        if stage.is_system:
            raise CRMServiceError(
                'SYSTEM_STAGE_PROTECTED',
                'Системный этап нельзя изменить.',
                status.HTTP_403_FORBIDDEN,
            )
        if stage.version != submitted_version:
            raise CRMServiceError(
                'VERSION_CONFLICT',
                'Этап был изменён другим пользователем.',
                status.HTTP_409_CONFLICT,
                current_version=stage.version,
            )
        changed = False
        if 'name' in data and data['name'] != stage.name:
            _validate_stage_name(workspace, data['name'], exclude_id=stage.id)
            stage.name = data['name']
            changed = True
        stages = list(SalesStage.objects.filter(
            workspace=workspace,
            is_deleted=False,
        ).order_by('order'))
        if 'order' in data:
            new_order = min(max(data['order'], 2), len(stages))
            if new_order != stage.order:
                stages.remove(stage)
                stages.insert(new_order - 1, stage)
                _reorder(workspace, stages)
                changed = True
        if changed:
            stage.version += 1
            stage.save(update_fields=('name', 'name_normalized', 'version', 'updated_at'))
            correlation_id = uuid.uuid4()
            _event(
                workspace.id,
                'stage_updated',
                correlation_id,
                stage=StageReadSerializer(stage).data,
            )
    return stage


def delete_stage(*, workspace, stage_id, submitted_version):
    with transaction.atomic():
        stage = SalesStage.objects.select_for_update().filter(
            id=stage_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if stage is None:
            raise CRMServiceError(
                'STAGE_NOT_FOUND', 'Этап не найден.', status.HTTP_404_NOT_FOUND,
            )
        if stage.is_system:
            raise CRMServiceError(
                'SYSTEM_STAGE_PROTECTED',
                'Системный этап нельзя удалить.',
                status.HTTP_403_FORBIDDEN,
            )
        if stage.version != submitted_version:
            raise CRMServiceError(
                'VERSION_CONFLICT',
                'Этап был изменён другим пользователем.',
                status.HTTP_409_CONFLICT,
                current_version=stage.version,
            )
        system_stage = SalesStage.objects.select_for_update().get(
            workspace=workspace,
            is_system=True,
            is_deleted=False,
        )
        deals = list(Deal.objects.select_for_update().filter(
            workspace=workspace,
            stage=stage,
            is_deleted=False,
        ))
        correlation_id = uuid.uuid4()
        for deal in deals:
            old_stage_id = deal.stage_id
            deal.stage = system_stage
            deal.version += 1
            deal.save(update_fields=('stage', 'version', 'updated_at'))
            _record_history(
                workspace=workspace,
                deal=deal,
                event_type=DealEvent.STAGE_CHANGED,
                changed_by_type=ChangedByType.SYSTEM,
                changes={
                    'stage_id': {
                        'old': str(old_stage_id),
                        'new': str(system_stage.id),
                    },
                },
                reason='stage_deleted',
                correlation_id=correlation_id,
            )
        stage.is_deleted = True
        stage.deleted_at = timezone.now()
        stage.save(update_fields=('is_deleted', 'deleted_at', 'updated_at'))
        remaining = list(SalesStage.objects.filter(
            workspace=workspace,
            is_deleted=False,
        ).order_by('order'))
        _reorder(workspace, remaining)
        if len(deals) >= 50:
            _event(
                workspace.id,
                'deals_stage_changed_batch',
                correlation_id,
                data={
                    'from_stage_id': str(stage.id),
                    'to_stage_id': str(system_stage.id),
                    'count': len(deals),
                },
            )
        else:
            for deal in deals:
                _event(
                    workspace.id,
                    'deal_stage_changed',
                    correlation_id,
                    deal_id=str(deal.id),
                    from_stage_id=str(stage.id),
                    to_stage_id=str(system_stage.id),
                )
        _event(
            workspace.id,
            'stage_deleted',
            correlation_id,
            stage_id=str(stage.id),
        )
