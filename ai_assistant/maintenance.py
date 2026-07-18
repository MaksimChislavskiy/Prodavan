from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import AIChatSession, AIChatSessionStatus


def close_inactive_chat_sessions(*, now=None, idle_minutes=None, batch_size=1000):
    """Close inactive sessions without deleting their retained chat history."""
    now = now or timezone.now()
    idle_minutes = (
        settings.AI_CHAT_SESSION_IDLE_MINUTES
        if idle_minutes is None
        else idle_minutes
    )
    if idle_minutes < 1:
        raise ValueError('idle_minutes must be greater than zero')
    if batch_size < 1:
        raise ValueError('batch_size must be greater than zero')

    cutoff = now - timedelta(minutes=idle_minutes)
    closed = 0
    while True:
        session_ids = list(
            AIChatSession.objects.filter(
                status=AIChatSessionStatus.OPEN,
                deleted_at__isnull=True,
                last_activity_at__lte=cutoff,
            )
            .order_by('pk')
            .values_list('pk', flat=True)[:batch_size],
        )
        if not session_ids:
            return closed

        closed += AIChatSession.objects.filter(
            pk__in=session_ids,
            status=AIChatSessionStatus.OPEN,
            deleted_at__isnull=True,
            last_activity_at__lte=cutoff,
        ).update(
            status=AIChatSessionStatus.CLOSED,
            closed_at=now,
            updated_at=now,
        )
