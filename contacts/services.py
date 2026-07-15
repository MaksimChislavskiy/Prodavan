import uuid

from django.db import transaction
from django.utils import timezone

from .models import Contact, ContactAuditAction, ContactAuditLog


CONTACT_FIELDS = ('name', 'company', 'phone', 'email', 'telegram', 'comment')


class ContactServiceError(Exception):
    def __init__(self, code, message, *, status_code=400, extra=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = extra or {}

    @property
    def response_data(self):
        if self.code == 'version_conflict':
            return {
                'error': self.code,
                'current_version': self.extra['current_version'],
            }
        return {'error': {'code': self.code, 'message': self.message}}


def request_audit_context(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    ip_address = forwarded.split(',', 1)[0].strip() if forwarded else None
    if ip_address is None:
        ip_address = request.META.get('REMOTE_ADDR')
    return {
        'ip_address': ip_address,
        'user_agent': request.META.get('HTTP_USER_AGENT', '')[:2000],
    }


def _audit(*, workspace, user, action, contact_id=None, changes=None, context=None):
    context = context or {}
    ContactAuditLog.objects.create(
        workspace=workspace,
        user=user,
        action=action,
        contact_identifier=contact_id,
        changes=changes or {},
        ip_address=context.get('ip_address'),
        user_agent=context.get('user_agent', ''),
        correlation_id=uuid.uuid4(),
    )


def create_contact(
    *,
    workspace,
    user,
    data,
    source='user',
    audit_context=None,
    audit_changes=None,
):
    with transaction.atomic():
        contact = Contact.objects.create(workspace=workspace, **data)
        changes = {'source': source}
        changes.update(audit_changes or {})
        _audit(
            workspace=workspace,
            user=user,
            action=ContactAuditAction.CREATED,
            contact_id=contact.id,
            changes=changes,
            context=audit_context,
        )
    return contact


def update_contact(
    *,
    workspace,
    user,
    contact_id,
    submitted_version,
    data,
    audit_context=None,
):
    with transaction.atomic():
        contact = Contact.objects.select_for_update().filter(
            id=contact_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if contact is None:
            raise ContactServiceError(
                'CONTACT_NOT_FOUND',
                'Контакт не найден.',
                status_code=404,
            )
        if contact.version != submitted_version:
            raise ContactServiceError(
                'version_conflict',
                'Контакт был изменён другим пользователем.',
                status_code=409,
                extra={'current_version': contact.version},
            )

        changes = {}
        update_fields = []
        for field, new_value in data.items():
            old_value = getattr(contact, field)
            if old_value == new_value:
                continue
            changes[field] = {'old': old_value, 'new': new_value}
            setattr(contact, field, new_value)
            update_fields.append(field)
        if not changes:
            return contact

        contact.version += 1
        update_fields.extend(('version', 'updated_at'))
        contact.save(update_fields=update_fields)
        _audit(
            workspace=workspace,
            user=user,
            action=ContactAuditAction.UPDATED,
            contact_id=contact.id,
            changes=changes,
            context=audit_context,
        )
    return contact


def delete_contact(*, workspace, user, contact_id, audit_context=None):
    from tasks.services import detach_tasks_for_contacts

    with transaction.atomic():
        contact = Contact.objects.select_for_update().filter(
            id=contact_id,
            workspace=workspace,
            is_deleted=False,
        ).first()
        if contact is None:
            raise ContactServiceError(
                'CONTACT_NOT_FOUND',
                'Контакт не найден.',
                status_code=404,
            )
        now = timezone.now()
        contact.is_deleted = True
        contact.deleted_at = now
        contact.save(update_fields=('is_deleted', 'deleted_at', 'updated_at'))
        _audit(
            workspace=workspace,
            user=user,
            action=ContactAuditAction.DELETED,
            contact_id=contact.id,
            context=audit_context,
        )
        detach_tasks_for_contacts(
            workspace=workspace,
            contact_ids=[contact.id],
        )


def bulk_delete_contacts(*, workspace, user, contact_ids, audit_context=None):
    from tasks.services import detach_tasks_for_contacts

    with transaction.atomic():
        contacts = {
            contact.id: contact
            for contact in Contact.objects.select_for_update().filter(
                workspace=workspace,
                id__in=contact_ids,
            )
        }
        active_ids = []
        skipped_ids = []
        for contact_id in contact_ids:
            contact = contacts.get(contact_id)
            if contact is None:
                skipped_ids.append(
                    {'id': str(contact_id), 'reason': 'not_found'},
                )
            elif contact.is_deleted:
                skipped_ids.append(
                    {'id': str(contact_id), 'reason': 'already_deleted'},
                )
            else:
                active_ids.append(contact_id)

        now = timezone.now()
        if active_ids:
            Contact.objects.filter(
                workspace=workspace,
                id__in=active_ids,
                is_deleted=False,
            ).update(is_deleted=True, deleted_at=now, updated_at=now)
            detach_tasks_for_contacts(
                workspace=workspace,
                contact_ids=active_ids,
            )
        _audit(
            workspace=workspace,
            user=user,
            action=ContactAuditAction.BULK_DELETED,
            changes={
                'deleted_count': len(active_ids),
                'skipped_count': len(skipped_ids),
                'first_10_ids': [str(value) for value in active_ids[:10]],
            },
            context=audit_context,
        )
    return {
        'deleted_count': len(active_ids),
        'skipped_ids': skipped_ids,
    }
