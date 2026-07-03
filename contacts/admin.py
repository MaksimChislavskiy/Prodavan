from django.contrib import admin

from .models import Contact, ContactAuditLog


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = (
        'name', 'workspace', 'phone', 'email', 'version', 'is_deleted',
        'updated_at',
    )
    list_filter = ('is_deleted',)
    search_fields = ('name', 'company', 'phone', 'email', 'telegram')
    readonly_fields = ('version', 'created_at', 'updated_at', 'deleted_at')


@admin.register(ContactAuditLog)
class ContactAuditLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'workspace', 'contact_identifier', 'created_at')
    list_filter = ('action',)
    search_fields = ('workspace__name', 'contact_identifier')
    readonly_fields = (
        'workspace', 'user', 'action', 'contact_identifier', 'changes',
        'ip_address', 'user_agent', 'correlation_id', 'created_at',
    )
