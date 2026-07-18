import base64
import hashlib
import json
import logging
import os
from datetime import timedelta

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from .models import (
    AuthEmailDelivery,
    AuthEmailDeliveryStatus,
)


MAX_RETRY_ATTEMPTS = 3
RETRY_DELAY = timedelta(minutes=1)
MAX_ENCRYPTED_PAYLOAD_SIZE = 64 * 1024
logger = logging.getLogger(__name__)


class AuthEmailPayloadError(Exception):
    pass


def _encode(value):
    return base64.urlsafe_b64encode(value).decode('ascii')


def _decode(value):
    return base64.urlsafe_b64decode(value.encode('ascii'))


def _associated_data(delivery_id, key_id):
    return f'prodavan:auth-email:{delivery_id}:{key_id}'.encode('utf-8')


def _encrypt_payload(*, delivery_id, payload):
    key_id = settings.INTEGRATION_ENCRYPTION_KEY_ID
    nonce = os.urandom(12)
    plaintext = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(',', ':'),
    ).encode('utf-8')
    ciphertext = AESGCM(
        _decode(settings.INTEGRATION_ENCRYPTION_KEY),
    ).encrypt(
        nonce,
        plaintext,
        _associated_data(delivery_id, key_id),
    )
    envelope = {
        'version': 1,
        'algorithm': 'AES-256-GCM',
        'key_id': key_id,
        'nonce': _encode(nonce),
        'ciphertext': _encode(ciphertext),
    }
    if len(json.dumps(envelope).encode('utf-8')) > MAX_ENCRYPTED_PAYLOAD_SIZE:
        raise AuthEmailPayloadError('Зашифрованное письмо слишком велико.')
    return envelope


def _decrypt_payload(delivery):
    envelope = delivery.encrypted_payload
    try:
        if envelope.get('version') != 1:
            raise AuthEmailPayloadError('Неизвестная версия шифрования.')
        if envelope.get('algorithm') != 'AES-256-GCM':
            raise AuthEmailPayloadError('Неизвестный алгоритм шифрования.')
        key_id = envelope['key_id']
        if key_id != settings.INTEGRATION_ENCRYPTION_KEY_ID:
            raise AuthEmailPayloadError('Ключ шифрования недоступен.')
        plaintext = AESGCM(
            _decode(settings.INTEGRATION_ENCRYPTION_KEY),
        ).decrypt(
            _decode(envelope['nonce']),
            _decode(envelope['ciphertext']),
            _associated_data(delivery.id, key_id),
        )
        payload = json.loads(plaintext.decode('utf-8'))
        if not all(payload.get(field) for field in ('recipient', 'subject', 'message')):
            raise AuthEmailPayloadError('Зашифрованное письмо повреждено.')
        return payload
    except (KeyError, ValueError, UnicodeError, InvalidTag, json.JSONDecodeError) as error:
        raise AuthEmailPayloadError(
            'Не удалось расшифровать письмо.',
        ) from error


def _recipient_hash(recipient):
    return hashlib.sha256(recipient.strip().lower().encode('utf-8')).hexdigest()


def _send(*, recipient, subject, message):
    sent = send_mail(
        subject=subject,
        message=message,
        from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
        recipient_list=[recipient],
        fail_silently=False,
    )
    if sent != 1:
        raise RuntimeError('Почтовый backend не подтвердил отправку письма.')


def deliver_or_enqueue_auth_email(
    *,
    recipient,
    purpose,
    subject,
    message,
    expires_at,
):
    recipient_hash = _recipient_hash(recipient)
    AuthEmailDelivery.objects.filter(
        recipient_hash=recipient_hash,
        purpose=purpose,
        status=AuthEmailDeliveryStatus.PENDING,
    ).update(
        status=AuthEmailDeliveryStatus.CANCELLED,
        next_attempt_at=None,
        updated_at=timezone.now(),
    )
    try:
        _send(recipient=recipient, subject=subject, message=message)
        return None
    except Exception as error:
        error_type = type(error).__name__
        logger.warning(
            'Auth email delivery failed; queued for retry: %s',
            error_type,
        )

    delivery = AuthEmailDelivery(
        recipient_hash=recipient_hash,
        purpose=purpose,
        status=AuthEmailDeliveryStatus.PENDING,
        next_attempt_at=timezone.now(),
        expires_at=expires_at,
        last_error=error_type,
    )
    delivery.encrypted_payload = _encrypt_payload(
        delivery_id=delivery.id,
        payload={
            'recipient': recipient,
            'subject': subject,
            'message': message,
        },
    )
    delivery.save(force_insert=True)
    return delivery


def process_auth_email_delivery(delivery_id, *, now=None):
    now = now or timezone.now()
    with transaction.atomic():
        delivery = (
            AuthEmailDelivery.objects.select_for_update()
            .filter(id=delivery_id)
            .first()
        )
        if (
            delivery is None
            or delivery.status != AuthEmailDeliveryStatus.PENDING
            or delivery.next_attempt_at is None
            or delivery.next_attempt_at > now
        ):
            return False
        if delivery.expires_at <= now:
            delivery.status = AuthEmailDeliveryStatus.EXPIRED
            delivery.next_attempt_at = None
            delivery.save(
                update_fields=('status', 'next_attempt_at', 'updated_at'),
            )
            return True

        delivery.attempts += 1
        try:
            payload = _decrypt_payload(delivery)
            _send(**payload)
        except Exception as error:
            delivery.last_error = type(error).__name__[:1000]
            if delivery.attempts >= MAX_RETRY_ATTEMPTS:
                delivery.status = AuthEmailDeliveryStatus.FAILED
                delivery.next_attempt_at = None
            else:
                delivery.next_attempt_at = now + RETRY_DELAY
            delivery.save(
                update_fields=(
                    'status', 'attempts', 'next_attempt_at', 'last_error',
                    'updated_at',
                ),
            )
            return True

        delivery.status = AuthEmailDeliveryStatus.SENT
        delivery.sent_at = now
        delivery.next_attempt_at = None
        delivery.last_error = ''
        delivery.save(
            update_fields=(
                'status', 'attempts', 'next_attempt_at', 'sent_at',
                'last_error', 'updated_at',
            ),
        )
        return True


def process_pending_auth_emails(*, limit=100, now=None):
    now = now or timezone.now()
    delivery_ids = list(
        AuthEmailDelivery.objects.filter(
            status=AuthEmailDeliveryStatus.PENDING,
            next_attempt_at__lte=now,
        )
        .order_by('next_attempt_at', 'created_at')
        .values_list('id', flat=True)[:limit],
    )
    processed = 0
    for delivery_id in delivery_ids:
        if process_auth_email_delivery(delivery_id, now=now):
            processed += 1
    return processed
