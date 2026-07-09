from django.db.models.signals import post_save
from django.dispatch import receiver

from messaging.models import Message

from .automation import enqueue_automation_event
from .autopilot import schedule_autopilot_for_message


@receiver(
    post_save,
    sender=Message,
    dispatch_uid='ai_assistant_enqueue_message_automation',
)
def enqueue_message_automation(sender, instance, created, **kwargs):
    if not created:
        return
    enqueue_automation_event(instance)
    schedule_autopilot_for_message(instance)
