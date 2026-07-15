from django.db.models import Q
from django.utils import timezone

from .models import (
    DeletedEmailReservation,
    PasswordResetToken,
    RefreshToken,
    RegistrationToken,
)


def _delete_in_batches(*, model, queryset, batch_size):
    deleted = 0
    while True:
        object_ids = list(
            queryset.order_by('pk').values_list('pk', flat=True)[:batch_size],
        )
        if not object_ids:
            return deleted
        model.objects.filter(pk__in=object_ids).delete()
        deleted += len(object_ids)


def cleanup_expired_auth_records(*, now=None, batch_size=1000):
    """Delete terminal authentication records in bounded database batches."""
    if batch_size < 1:
        raise ValueError('batch_size must be greater than zero')

    now = now or timezone.now()
    counters = {
        'registration_tokens': _delete_in_batches(
            model=RegistrationToken,
            queryset=RegistrationToken.objects.filter(code_expires_at__lte=now),
            batch_size=batch_size,
        ),
        'password_reset_tokens': _delete_in_batches(
            model=PasswordResetToken,
            queryset=PasswordResetToken.objects.filter(
                Q(code_expires_at__lte=now) | Q(used=True),
            ),
            batch_size=batch_size,
        ),
        'refresh_tokens': _delete_in_batches(
            model=RefreshToken,
            queryset=RefreshToken.objects.filter(
                Q(expires_at__lte=now) | Q(revoked=True),
            ),
            batch_size=batch_size,
        ),
        'email_reservations': _delete_in_batches(
            model=DeletedEmailReservation,
            queryset=DeletedEmailReservation.objects.filter(release_at__lte=now),
            batch_size=batch_size,
        ),
    }
    counters['total'] = sum(counters.values())
    return counters
