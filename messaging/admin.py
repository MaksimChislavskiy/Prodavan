from django.contrib import admin

from .models import Chat, ChatAuditLog, Message


@admin.register(Chat)
class ChatAdmin(admin.ModelAdmin):
    list_display = (
        'contact', 'workspace', 'unread_count', 'last_message_at', 'is_deleted',
    )
    list_filter = ('is_deleted',)
    search_fields = ('contact__name', 'contact__company')
    readonly_fields = ('created_at', 'updated_at', 'deleted_at')


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('chat', 'sender_type', 'status', 'read_at', 'created_at')
    list_filter = ('sender_type', 'status', 'is_deleted', 'sent_by_ai')
    search_fields = ('text', 'sender_id')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(ChatAuditLog)
class ChatAuditLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'workspace', 'chat_identifier', 'created_at')
    list_filter = ('action',)
    readonly_fields = (
        'workspace', 'user', 'action', 'chat_identifier',
        'message_identifier', 'details', 'ip_address', 'user_agent',
        'correlation_id', 'created_at',
    )
