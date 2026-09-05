from django.db.models.signals import post_save
from django.dispatch import receiver

from messaging.models import Message, MessageSenderType

from .automation import enqueue_automation_event
from .autopilot import cancel_pending_fallback_jobs, schedule_autopilot_for_message


@receiver(
    post_save,
    sender=Message,
    dispatch_uid='ai_assistant_enqueue_message_automation',
)
def enqueue_message_automation(sender, instance, created, **kwargs):
    if not created:
        return
    enqueue_automation_event(instance)
    if instance.sender_type == MessageSenderType.USER and instance.sent_by_ai:
        cancel_pending_fallback_jobs(
            chat=instance.chat,
            reason='ai_replied',
        )
    schedule_autopilot_for_message(instance)
