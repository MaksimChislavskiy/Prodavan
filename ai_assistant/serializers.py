from collections.abc import Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone
from rest_framework import serializers

from .models import AISettings, AIUsageDaily, AutopilotMode


AI_LIMITS = {
    'daily_deal_creation': 50,
    'daily_task_creation': 100,
    'daily_contact_updates': 50,
    'daily_autopilot_replies': 50,
    'hourly_autopilot_replies_per_chat': 10,
    'max_consecutive_ai_replies': 5,
    'tasks_per_chat_24h': 5,
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
        )

    def get_limits(self, instance):
        return dict(AI_LIMITS)

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
