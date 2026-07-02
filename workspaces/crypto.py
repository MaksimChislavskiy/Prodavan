import base64
import json
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings


MAX_ENCRYPTED_CONFIG_SIZE = 64 * 1024


class IntegrationSecretError(Exception):
    pass


def _decode(value):
    return base64.urlsafe_b64decode(value.encode('ascii'))


def _encode(value):
    return base64.urlsafe_b64encode(value).decode('ascii')


def _associated_data(workspace_id, integration_type, key_id):
    return (
        f'prodavan:integration:{workspace_id}:{integration_type}:{key_id}'
    ).encode('utf-8')


def encrypt_integration_secret(*, secret, workspace_id, integration_type):
    key_id = settings.INTEGRATION_ENCRYPTION_KEY_ID
    key = _decode(settings.INTEGRATION_ENCRYPTION_KEY)
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(
        nonce,
        secret.encode('utf-8'),
        _associated_data(workspace_id, integration_type, key_id),
    )
    envelope = {
        'version': 1,
        'algorithm': 'AES-256-GCM',
        'key_id': key_id,
        'nonce': _encode(nonce),
        'ciphertext': _encode(ciphertext),
    }
    if len(json.dumps(envelope).encode('utf-8')) > MAX_ENCRYPTED_CONFIG_SIZE:
        raise IntegrationSecretError('Зашифрованная конфигурация слишком велика.')
    return envelope


def decrypt_integration_secret(*, envelope, workspace_id, integration_type):
    try:
        if envelope.get('version') != 1:
            raise IntegrationSecretError('Неизвестная версия шифрования.')
        if envelope.get('algorithm') != 'AES-256-GCM':
            raise IntegrationSecretError('Неизвестный алгоритм шифрования.')
        key_id = envelope['key_id']
        if key_id != settings.INTEGRATION_ENCRYPTION_KEY_ID:
            raise IntegrationSecretError('Ключ шифрования недоступен.')
        plaintext = AESGCM(_decode(settings.INTEGRATION_ENCRYPTION_KEY)).decrypt(
            _decode(envelope['nonce']),
            _decode(envelope['ciphertext']),
            _associated_data(workspace_id, integration_type, key_id),
        )
        return plaintext.decode('utf-8')
    except (KeyError, ValueError, UnicodeError, InvalidTag) as error:
        raise IntegrationSecretError(
            'Не удалось расшифровать конфигурацию интеграции.',
        ) from error
