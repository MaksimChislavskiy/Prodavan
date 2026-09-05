import uuid

from django.test import TestCase

from users.models import User

from .models import (
    AIAutomationAuditAction,
    AIAutomationAuditLog,
    AutomationActionType,
)


class UpdatedTzAutomationSection17Tests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='section17@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

    def test_low_confidence_skip_audit_uses_exact_reason(self):
        log = AIAutomationAuditLog.objects.create(
            workspace=self.user.workspace,
            user=self.user,
            action=AIAutomationAuditAction.AI_DECISION_SKIPPED,
            action_type=AutomationActionType.CONTACT_ENRICHMENT,
            trigger='chat_message_received',
            correlation_id=uuid.uuid4(),
            details={
                'status': 'skipped_low_confidence',
                'source': 'ai',
            },
        )

        self.assertEqual(log.details['status'], 'skipped_low_confidence')
        self.assertEqual(log.details['reason'], 'low_confidence')

    def test_explicit_audit_reason_is_not_overwritten(self):
        log = AIAutomationAuditLog.objects.create(
            workspace=self.user.workspace,
            user=self.user,
            action=AIAutomationAuditAction.AI_DECISION_SKIPPED,
            action_type=AutomationActionType.CONTACT_ENRICHMENT,
            trigger='chat_message_received',
            correlation_id=uuid.uuid4(),
            details={
                'status': 'skipped_low_confidence',
                'reason': 'custom_reason',
            },
        )

        self.assertEqual(log.details['reason'], 'custom_reason')

    def test_created_ai_deal_uses_interest_detected_trigger(self):
        log = AIAutomationAuditLog.objects.create(
            workspace=self.user.workspace,
            user=self.user,
            action=AIAutomationAuditAction.AI_DEAL_CREATED,
            action_type=AutomationActionType.DEAL_CREATE,
            trigger='chat_message_received',
            correlation_id=uuid.uuid4(),
            details={
                'status': 'created',
                'source': 'ai',
            },
        )

        self.assertEqual(log.trigger, 'interest_detected')
