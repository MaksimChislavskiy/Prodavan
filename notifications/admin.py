from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'workspace',
        'user',
        'type',
        'title',
        'is_read',
        'is_deleted',
        'created_at',
    )
    list_filter = ('type', 'is_read', 'is_deleted', 'created_at')
    search_fields = ('title', 'content', 'entity_id', 'user__email')
    readonly_fields = ('id', 'created_at', 'updated_at')
