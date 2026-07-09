from rest_framework import serializers

from contacts.models import Contact

from .models import Chat, Message


class ChatContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ('id', 'name', 'company', 'is_deleted')


class ChatSerializer(serializers.ModelSerializer):
    contact = ChatContactSerializer(read_only=True)

    class Meta:
        model = Chat
        fields = (
            'id', 'contact', 'last_message', 'last_message_at',
            'unread_count', 'ai_autopilot_enabled',
        )


class MessageSerializer(serializers.ModelSerializer):
    chat_id = serializers.UUIDField(source='chat.id', read_only=True)

    class Meta:
        model = Message
        fields = (
            'id', 'chat_id', 'sender_type', 'sender_id', 'text', 'status',
            'read_at', 'sent_by_ai', 'created_at',
        )


class OutgoingMessageSerializer(serializers.Serializer):
    text = serializers.CharField(
        min_length=1,
        max_length=4096,
        trim_whitespace=True,
    )

    def validate_text(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Сообщение не может быть пустым.')
        return value


class ChatAutopilotSerializer(serializers.Serializer):
    ai_autopilot_enabled = serializers.BooleanField(allow_null=True)

    def to_internal_value(self, data):
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {field: 'Неизвестное поле.' for field in sorted(unknown)},
            )
        return super().to_internal_value(data)
