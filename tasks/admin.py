from django.contrib import admin

from .models import Task, TaskAuditLog, TaskHistory, TaskIdempotencyRecord


admin.site.register(Task)
admin.site.register(TaskHistory)
admin.site.register(TaskAuditLog)
admin.site.register(TaskIdempotencyRecord)
