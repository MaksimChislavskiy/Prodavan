from django.contrib import admin

from .models import (
    AIAuditLog,
    AIAutomationEvent,
    AIChatInsight,
    AISettings,
    AIUsageDaily,
    AIChatMessage,
    AIChatSession,
    AIProcessedEvent,
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
    list_display = (
        'workspace',
        'date',
        'deals_created',
        'tasks_created',
        'contacts_updated',
        'autopilot_replies',
    )
    list_filter = ('date',)


@admin.register(AIAutomationEvent)
class AIAutomationEventAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'workspace',
        'chat',
        'status',
        'attempts',
        'available_at',
        'processed_at',
    )
    list_filter = ('status', 'failure_type', 'event_type')
    search_fields = ('id', 'message__text', 'last_error')
    readonly_fields = (
        'id',
        'workspace',
        'chat',
        'message',
        'event_type',
        'attempts',
        'analysis',
        'created_at',
        'updated_at',
    )


@admin.register(AIProcessedEvent)
class AIProcessedEventAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'workspace',
        'chat',
        'action_type',
        'created_at',
        'expires_at',
    )
    list_filter = ('action_type',)
    search_fields = ('idempotency_key',)
    readonly_fields = (
        'id',
        'workspace',
        'event',
        'chat',
        'action_type',
        'idempotency_key',
        'result',
        'created_at',
        'expires_at',
    )


@admin.register(AIChatInsight)
class AIChatInsightAdmin(admin.ModelAdmin):
    list_display = ('id', 'workspace', 'chat', 'message_count', 'sentiment', 'created_at')
    search_fields = ('summary',)
    readonly_fields = (
        'id',
        'workspace',
        'chat',
        'source_message',
        'message_count',
        'summary',
        'sentiment',
        'objections',
        'recommendations',
        'created_at',
    )


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
