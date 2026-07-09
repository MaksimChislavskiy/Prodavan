from django.contrib import admin

from .models import Deal, DealHistory, DealIdempotencyRecord, SalesStage


admin.site.register(SalesStage)
admin.site.register(Deal)
admin.site.register(DealHistory)
admin.site.register(DealIdempotencyRecord)
