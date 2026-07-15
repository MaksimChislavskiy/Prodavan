import uuid

from django.db import transaction

from .models import AIAuditAction, AIAuditLog, AISettings


class AISettingsServiceError(Exception):
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


def get_ai_settings(workspace):
    settings_object, _ = AISettings.objects.get_or_create(workspace=workspace)
    return settings_object


def _change(old_value, new_value):
    return {'old': old_value, 'new': new_value}


def _write_audit_logs(*, settings_object, user, changes, request_id):
    logs = []
    if 'instruction' in changes:
        logs.append(
            AIAuditLog(
                workspace=settings_object.workspace,
                user=user,
                user_identifier=user.id,
                action=AIAuditAction.INSTRUCTION_UPDATED,
                changes={'instruction': changes['instruction']},
                request_id=request_id,
            ),
        )

    autopilot_changes = {
        key: value
        for key, value in changes.items()
        if key.startswith('autopilot_')
    }
    if autopilot_changes:
        logs.append(
            AIAuditLog(
                workspace=settings_object.workspace,
                user=user,
                user_identifier=user.id,
                action=AIAuditAction.AUTOPILOT_SETTINGS_CHANGED,
                changes=autopilot_changes,
                request_id=request_id,
            ),
        )

    AIAuditLog.objects.bulk_create(logs)


def update_ai_settings(*, workspace_id, user, validated_data):
    submitted_version = validated_data['version']

    with transaction.atomic():
        AISettings.objects.get_or_create(workspace_id=workspace_id)
        settings_object = (
            AISettings.objects.select_for_update()
            .select_related('workspace')
            .get(workspace_id=workspace_id)
        )

        if settings_object.version != submitted_version:
            raise AISettingsServiceError(
                'VERSION_CONFLICT',
                'Настройки были изменены другим пользователем или в другой '
                'вкладке. Обновите страницу и повторите попытку.',
                status_code=409,
                extra={'current_version': settings_object.version},
            )

        changes = {}
        update_fields = []
        for field_name in (
            'instruction',
            'autopilot_enabled',
            'autopilot_mode',
            'autopilot_delay',
        ):
            if field_name not in validated_data:
                continue
            old_value = getattr(settings_object, field_name)
            new_value = validated_data[field_name]
            if old_value == new_value:
                continue
            setattr(settings_object, field_name, new_value)
            changes[field_name] = _change(old_value, new_value)
            update_fields.append(field_name)

        if changes:
            settings_object.version += 1
            settings_object.save(
                update_fields=tuple(update_fields + ['version', 'updated_at']),
            )
            _write_audit_logs(
                settings_object=settings_object,
                user=user,
                changes=changes,
                request_id=uuid.uuid4(),
            )

    return settings_object
