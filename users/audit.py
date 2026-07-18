import hashlib

from .models import AuthAuditLog


def write_auth_audit(
    *,
    request,
    action,
    email,
    successful,
    user=None,
    details=None,
):
    normalized_email = email.strip().lower()
    return AuthAuditLog.objects.create(
        user=user,
        user_identifier=getattr(user, 'id', None),
        email_hash=hashlib.sha256(normalized_email.encode('utf-8')).hexdigest(),
        action=action,
        successful=successful,
        details=details or {},
        ip_address=request.META.get('REMOTE_ADDR') or None,
        user_agent=request.META.get('HTTP_USER_AGENT', '')[:2000],
    )
