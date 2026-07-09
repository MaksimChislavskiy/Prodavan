from django.db.models.signals import post_save
from django.dispatch import receiver

from workspaces.models import Workspace

from .models import SalesStage


@receiver(post_save, sender=Workspace, dispatch_uid='deals_create_system_stage')
def create_system_stage(sender, instance, created, **kwargs):
    if created:
        SalesStage.objects.get_or_create(
            workspace=instance,
            is_system=True,
            defaults={
                'name': 'Новый лид',
                'name_normalized': 'новый лид',
                'order': 1,
            },
        )
