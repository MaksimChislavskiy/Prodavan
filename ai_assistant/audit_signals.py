from django.db.models.signals import pre_save
from django.dispatch import receiver

from .models import AIAutomationAuditLog, AutomationActionType


@receiver(
    pre_save,
    sender=AIAutomationAuditLog,
    dispatch_uid='ai_assistant_normalize_section17_audit_contracts',
)
def normalize_section17_audit_contracts(sender, instance, **kwargs):
    details = instance.details
    if not isinstance(details, dict):
        details = {}

    if (
        details.get('status') == 'skipped_low_confidence'
        and not details.get('reason')
    ):
        normalized = dict(details)
        normalized['reason'] = 'low_confidence'
        instance.details = normalized
        details = normalized

    if (
        instance.action_type == AutomationActionType.DEAL_CREATE
        and details.get('status') == 'created'
    ):
        instance.trigger = 'interest_detected'
