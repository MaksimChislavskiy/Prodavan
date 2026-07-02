from django.contrib import admin

from .models import (
    Workspace,
    WorkspaceAuditLog,
    WorkspaceIdempotencyRecord,
    WorkspaceIntegration,
    TelegramWebhookLog,
)


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ('name', 'timezone', 'language', 'version', 'created_at')
    search_fields = ('name',)
    readonly_fields = ('version', 'created_at', 'updated_at')


@admin.register(WorkspaceIntegration)
class WorkspaceIntegrationAdmin(admin.ModelAdmin):
    list_display = (
        'workspace', 'type', 'status', 'health_status',
        'consecutive_failures', 'last_check_at',
    )
    list_filter = ('type', 'status', 'health_status')
    search_fields = ('workspace__name', 'bot_username')
    exclude = ('config', 'webhook_secret_config')


@admin.register(TelegramWebhookLog)
class TelegramWebhookLogAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'update_id', 'processed', 'received_at')
    list_filter = ('processed',)
    search_fields = ('workspace__name', 'update_id')
    readonly_fields = (
        'workspace', 'update_id', 'payload', 'received_at',
        'processed', 'processing_error',
    )


@admin.register(WorkspaceAuditLog)
class WorkspaceAuditLogAdmin(admin.ModelAdmin):
    list_display = ('workspace_identifier', 'field', 'user_identifier', 'changed_at')
    search_fields = ('workspace_identifier', 'user_identifier', 'field')
    readonly_fields = (
        'user', 'workspace', 'user_identifier', 'workspace_identifier',
        'field', 'old_value', 'new_value', 'changed_at', 'request_id',
    )


@admin.register(WorkspaceIdempotencyRecord)
class WorkspaceIdempotencyRecordAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'key', 'user', 'created_at', 'expires_at')
    readonly_fields = (
        'workspace', 'user', 'key', 'request_hash', 'response_body',
        'response_status', 'response_etag', 'created_at', 'expires_at',
    )
