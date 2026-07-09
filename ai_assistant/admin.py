from django.contrib import admin

from .models import (
    AIAuditLog,
    AISettings,
    AIUsageDaily,
    AIChatMessage,
    AIChatSession,
    KnowledgeChunk,
    KnowledgeDocument,
)


@admin.register(AISettings)
class AISettingsAdmin(admin.ModelAdmin):
    list_display = (
        'workspace',
        'version',
        'autopilot_enabled',
        'autopilot_mode',
        'updated_at',
    )
    search_fields = ('workspace__name',)


@admin.register(AIAuditLog)
class AIAuditLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'workspace', 'user_identifier', 'created_at')
    list_filter = ('action',)
    search_fields = ('workspace__name', 'user_identifier')
    readonly_fields = (
        'id',
        'workspace',
        'user',
        'user_identifier',
        'action',
        'changes',
        'request_id',
        'created_at',
    )


@admin.register(AIUsageDaily)
class AIUsageDailyAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'date', 'autopilot_replies')
    list_filter = ('date',)


@admin.register(KnowledgeDocument)
class KnowledgeDocumentAdmin(admin.ModelAdmin):
    list_display = (
        'original_name',
        'workspace',
        'status',
        'size_bytes',
        'processing_attempts',
        'created_at',
    )
    list_filter = ('status', 'is_deleted')
    search_fields = ('original_name', 'workspace__name', 'sha256')
    readonly_fields = ('sha256', 'size_bytes', 'mime_type')


@admin.register(KnowledgeChunk)
class KnowledgeChunkAdmin(admin.ModelAdmin):
    list_display = ('document', 'position', 'token_count', 'created_at')
    search_fields = ('document__original_name',)


@admin.register(AIChatSession)
class AIChatSessionAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'user',
        'workspace',
        'status',
        'message_count',
        'last_activity_at',
    )
    list_filter = ('status', 'context_page')
    search_fields = ('user__email', 'workspace__name')


@admin.register(AIChatMessage)
class AIChatMessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'role', 'status', 'user', 'session', 'created_at')
    list_filter = ('role', 'status', 'provider')
    search_fields = ('content', 'user__email')
