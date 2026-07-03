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
            'unread_count',
        )


class MessageSerializer(serializers.ModelSerializer):
    chat_id = serializers.UUIDField(source='chat.id', read_only=True)

    class Meta:
        model = Message
        fields = (
            'id', 'chat_id', 'sender_type', 'sender_id', 'text', 'status',
            'read_at', 'sent_by_ai', 'created_at',
        )
