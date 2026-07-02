from django.db import models


class TimestampMixin(models.Model):
    """Миксин для добавления временных меток."""

    created_at = models.DateTimeField(
        auto_now_add=True, verbose_name='Дата создания'
    )
    updated_at = models.DateTimeField(
        auto_now=True, verbose_name='Дата обновления'
    )

    class Meta:
        abstract = True
