from django.contrib import admin

from .models import AIAuditLog, AISettings, AIUsageDaily


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
