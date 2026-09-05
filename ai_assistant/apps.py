from django.apps import AppConfig


class AiAssistantConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'ai_assistant'
    verbose_name = 'AI-помощник'

    def ready(self):
        from . import audit_signals  # noqa: F401
        from . import automation_signals  # noqa: F401
        from .autopilot import ESCALATION_SKIP_REASONS

        # Updated TZ section 16.6.4: after three consecutive customer
        # messages a low-confidence autopilot outcome is an escalation reason.
        ESCALATION_SKIP_REASONS.add('low_confidence')
