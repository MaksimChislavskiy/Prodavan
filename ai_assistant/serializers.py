from collections.abc import Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone
from rest_framework import serializers

from .limits import AI_LIMITS
from .models import (
    AIAutomationAuditLog,
    AISettings,
    AIUsageDaily,
    AutopilotMode,
    KnowledgeDocument,
)


PUBLIC_AI_LIMIT_KEYS = {
    'daily_deal_creation': 'daily_deal_creation',
    'daily_task_creation': 'daily_task_creation',
    'daily_contact_updates': 'daily_contact_updates',
    'daily_autopilot_replies': 'daily_autopilot_replies',
    'hourly_auto_replies_per_chat': 'hourly_autopilot_replies_per_chat',
    'max_consecutive_ai_replies': 'max_consecutive_ai_replies',
    'tasks_per_chat_24h': 'tasks_per_chat_24h',
}


def _workspace_local_date(workspace):
    try:
        zone = ZoneInfo(workspace.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo('UTC')
    return timezone.now().astimezone(zone).date()


class AISettingsSerializer(serializers.ModelSerializer):
    limits = serializers.SerializerMethodField()
    current_usage = serializers.SerializerMethodField()
    storage = serializers.SerializerMethodField()

    class Meta:
        model = AISettings
        fields = (
            'version',
            'instruction',
            'autopilot_enabled',
            'autopilot_mode',
            'autopilot_delay',
            'limits',
            'current_usage',
            'storage',
        )

    def get_limits(self, instance):
        return {
            public_key: AI_LIMITS[internal_key]
            for public_key, internal_key in PUBLIC_AI_LIMIT_KEYS.items()
        }

    def get_current_usage(self, instance):
        usage = AIUsageDaily.objects.filter(
            workspace=instance.workspace,
            date=_workspace_local_date(instance.workspace),
        ).first()
        return {
            'deals_today': usage.deals_created if usage else 0,
            'tasks_today': usage.tasks_created if usage else 0,
            'updates_today': usage.contacts_updated if usage else 0,
            'autopilot_replies_today': usage.autopilot_replies if usage else 0,
        }

    def get_storage(self, instance):
        from .knowledge import storage_usage

        usage = storage_usage(instance.workspace)
        return {
            'used_bytes': usage['used_bytes'],
            'max_bytes': usage['limit_bytes'],
            'files_count': usage['files_count'],
            'max_files': usage['files_limit'],
        }


class AISettingsUpdateSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=0)
    instruction = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=5000,
        trim_whitespace=False,
    )
    autopilot_enabled = serializers.BooleanField(required=False)
    autopilot_mode = serializers.ChoiceField(
        choices=AutopilotMode.choices,
        required=False,
    )
    autopilot_delay = serializers.IntegerField(
        min_value=1,
        max_value=60,
        required=False,
    )

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError(
                {
                    'non_field_errors': [
                        serializers.ErrorDetail(
                            'Ожидается JSON-объект.',
                            code='VALIDATION_ERROR',
                        ),
                    ],
                },
            )
        unknown_fields = set(data) - set(self.fields)
        if unknown_fields:
            raise serializers.ValidationError(
                {
                    'non_field_errors': [
                        serializers.ErrorDetail(
                            'Неизвестные поля: '
                            f'{", ".join(sorted(unknown_fields))}',
                            code='VALIDATION_ERROR',
                        ),
                    ],
                },
            )
        return super().to_internal_value(data)


class AISettingsResetSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=0)

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError(
                {'version': ['Укажите текущую версию настроек.']},
            )
        unknown_fields = set(data) - {'version'}
        if unknown_fields:
            raise serializers.ValidationError(
                {
                    'non_field_errors': [
                        'Неизвестные поля: '
                        f'{", ".join(sorted(unknown_fields))}',
                    ],
                },
            )
        return super().to_internal_value(data)


class KnowledgeDocumentSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='original_name')
    size = serializers.IntegerField(source='size_bytes')
    uploaded_at = serializers.DateTimeField(source='created_at')

    class Meta:
        model = KnowledgeDocument
        fields = (
            'id',
            'name',
            'size',
            'mime_type',
            'status',
            'error_reason',
            'processing_attempts',
            'uploaded_at',
            'processed_at',
        )


class AIAutomationAuditLogSerializer(serializers.ModelSerializer):
    workspace_id = serializers.UUIDField(source='workspace.id')
    user_id = serializers.UUIDField(source='user.id', allow_null=True)
    chat_id = serializers.UUIDField(source='chat.id', allow_null=True)
    message_id = serializers.UUIDField(source='message.id', allow_null=True)
    timestamp = serializers.DateTimeField(source='created_at')

    class Meta:
        model = AIAutomationAuditLog
        fields = (
            'id',
            'workspace_id',
            'action',
            'action_type',
            'trigger',
            'correlation_id',
            'user_id',
            'chat_id',
            'message_id',
            'raw_message',
            'ai_prompt',
            'ai_response',
            'ip',
            'user_agent',
            'confidence',
            'details',
            'timestamp',
            'created_at',
        )
