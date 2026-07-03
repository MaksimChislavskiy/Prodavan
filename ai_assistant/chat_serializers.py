from collections.abc import Mapping

from rest_framework import serializers

from .models import (
    AIChatContextPage,
    AIChatMessage,
    AIChatSession,
)


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError(
                {'non_field_errors': ['Ожидается JSON-объект.']},
            )
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {
                    'non_field_errors': [
                        f'Неизвестные поля: {", ".join(sorted(unknown))}',
                    ],
                },
            )
        return super().to_internal_value(data)


class AIChatContextSerializer(StrictSerializer):
    page = serializers.ChoiceField(choices=AIChatContextPage.choices)
    entity_id = serializers.UUIDField(required=False, allow_null=True)


class AIChatSessionCreateSerializer(StrictSerializer):
    context = AIChatContextSerializer(required=False)


class AIChatRequestSerializer(StrictSerializer):
    client_message_id = serializers.UUIDField()
    message = serializers.CharField(
        min_length=1,
        max_length=1000,
        trim_whitespace=True,
    )
    context = AIChatContextSerializer()
    session_id = serializers.UUIDField()

    def validate_message(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Введите запрос.')
        return value


class AIChatRetrySerializer(StrictSerializer):
    message_id = serializers.UUIDField()
    retry_token = serializers.UUIDField()


class AIChatSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIChatSession
        fields = (
            'id',
            'status',
            'context_page',
            'context_entity_id',
            'default_model_name',
            'created_at',
            'closed_at',
            'last_activity_at',
            'message_count',
        )


class AIChatMessageSerializer(serializers.ModelSerializer):
    session_id = serializers.UUIDField(read_only=True)
    parent_message_id = serializers.UUIDField(read_only=True, allow_null=True)
    client_message_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = AIChatMessage
        fields = (
            'id',
            'session_id',
            'role',
            'content',
            'status',
            'parent_message_id',
            'client_message_id',
            'created_at',
            'model_name',
            'provider',
            'prompt_tokens',
            'completion_tokens',
            'total_tokens',
            'processing_time_ms',
            'error',
            'metadata',
        )
