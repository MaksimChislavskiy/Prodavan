from urllib.parse import quote

from rest_framework import serializers

from contacts.models import Contact

from .attachment_tokens import create_attachment_token
from .models import Chat, Message, MessageAttachmentType


MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024


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
    attachment = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = (
            'id', 'chat_id', 'sender_type', 'sender_id', 'text', 'attachment',
            'status', 'read_at', 'sent_by_ai', 'created_at',
        )

    def get_attachment(self, obj):
        if not obj.attachment_type:
            return None

        url = None
        if obj.attachment_file:
            try:
                url = obj.attachment_file.url
            except (ValueError, NotImplementedError):
                url = None
        elif obj.attachment_external_id:
            token = quote(create_attachment_token(obj), safe='')
            url = f'/api/messages/{obj.id}/attachment?token={token}'

        return {
            'type': obj.attachment_type,
            'name': obj.attachment_name,
            'size': obj.attachment_size,
            'mime_type': obj.attachment_mime_type,
            'url': url,
            'preview_url': (
                url
                if obj.attachment_type == MessageAttachmentType.IMAGE
                else None
            ),
        }


class OutgoingMessageSerializer(serializers.Serializer):
    text = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=4096,
        trim_whitespace=False,
        default='',
    )
    attachment = serializers.FileField(required=False, allow_null=True)

    def validate_text(self, value):
        stripped = value.strip()
        if value and not stripped:
            raise serializers.ValidationError('Сообщение не может быть пустым.')
        return stripped

    def validate(self, attrs):
        text = attrs.get('text') or ''
        attachment = attrs.get('attachment')
        if not text and attachment is None:
            raise serializers.ValidationError(
                'Сообщение должно содержать текст или вложение.',
            )
        attrs['text'] = text
        return attrs


class ChatAutopilotSerializer(serializers.Serializer):
    ai_autopilot_enabled = serializers.BooleanField(allow_null=True)

    def to_internal_value(self, data):
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {field: 'Неизвестное поле.' for field in sorted(unknown)},
            )
        return super().to_internal_value(data)
