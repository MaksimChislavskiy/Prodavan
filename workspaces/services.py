import hashlib
import json
import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import (
    Workspace,
    WorkspaceAuditLog,
    WorkspaceIdempotencyRecord,
)


IDEMPOTENCY_TTL = timedelta(hours=24)


class WorkspaceServiceError(Exception):
    def __init__(self, code, message, *, status_code=400, extra=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = extra or {}

    @property
    def response_data(self):
        data = {'error': {'code': self.code, 'message': self.message}}
        data.update(self.extra)
        return data


def canonical_request_hash(data):
    payload = json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def _audit_value(value):
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def update_workspace_settings(
    *,
    workspace_id,
    user,
    validated_data,
    request_hash,
    idempotency_key=None,
):
    submitted_version = validated_data['version']
    request_id = uuid.uuid4()

    with transaction.atomic():
        workspace = (
            Workspace.objects.select_for_update()
            .prefetch_related('integrations')
            .get(id=workspace_id)
        )

        if idempotency_key is not None:
            record = (
                WorkspaceIdempotencyRecord.objects.select_for_update()
                .filter(workspace=workspace, key=idempotency_key)
                .first()
            )
            if record is not None and record.expires_at <= timezone.now():
                record.delete()
                record = None
            if record is not None:
                if record.request_hash != request_hash:
                    raise WorkspaceServiceError(
                        'IDEMPOTENCY_KEY_REUSED',
                        'Idempotency-Key уже использован с другим запросом.',
                        status_code=409,
                    )
                return record.response_body, record.response_etag, True

        if workspace.version != submitted_version:
            raise WorkspaceServiceError(
                'VERSION_CONFLICT',
                'Настройки были изменены другим пользователем.',
                status_code=409,
                extra={'current_version': workspace.version},
            )

        changes = []
        update_fields = []
        new_timezone = validated_data.get('timezone')
        if new_timezone is not None and new_timezone != workspace.timezone:
            changes.append(('timezone', workspace.timezone, new_timezone))
            workspace.timezone = new_timezone
            update_fields.append('timezone')

        company_patch = validated_data.get('company')
        if company_patch is not None:
            company = dict(workspace.company or {})
            for field_name, new_value in company_patch.items():
                old_value = company.get(field_name)
                if old_value == new_value:
                    continue
                company[field_name] = new_value
                changes.append((f'company.{field_name}', old_value, new_value))
            if any(field.startswith('company.') for field, _, _ in changes):
                workspace.company = company
                update_fields.append('company')
                if company_patch.get('full_name'):
                    workspace.name = company_patch['full_name']
                    update_fields.append('name')

        if changes:
            workspace.version += 1
            update_fields.extend(('version', 'updated_at'))
            workspace.save(update_fields=tuple(dict.fromkeys(update_fields)))
            WorkspaceAuditLog.objects.bulk_create(
                [
                    WorkspaceAuditLog(
                        user=user,
                        workspace=workspace,
                        user_identifier=user.id,
                        workspace_identifier=workspace.id,
                        field=field,
                        old_value=_audit_value(old_value),
                        new_value=_audit_value(new_value),
                        request_id=request_id,
                    )
                    for field, old_value, new_value in changes
                ],
            )

        from .serializers import WorkspaceSettingsSerializer

        response_body = WorkspaceSettingsSerializer(workspace).data
        etag = f'"{workspace.version}"'
        if idempotency_key is not None:
            WorkspaceIdempotencyRecord.objects.create(
                workspace=workspace,
                user=user,
                key=idempotency_key,
                request_hash=request_hash,
                response_body=response_body,
                response_status=200,
                response_etag=etag,
                expires_at=timezone.now() + IDEMPOTENCY_TTL,
            )

    return response_body, etag, False
