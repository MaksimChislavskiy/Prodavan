import tempfile
from unittest.mock import Mock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from users.models import User
from workspaces.crypto import encrypt_integration_secret
from workspaces.models import (
    IntegrationStatus,
    IntegrationType,
    WorkspaceIntegration,
)

from .models import Chat, Message, MessageAttachmentType, MessageStatus
from .outgoing import process_outgoing_message


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class ChatAttachmentContractTests(TestCase):
    def setUp(self):
        self.media_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.media_dir.cleanup)
        self.storage_override = override_settings(
            MEDIA_ROOT=self.media_dir.name,
            STORAGES={
                'default': {
                    'BACKEND': 'django.core.files.storage.FileSystemStorage',
                },
                'staticfiles': {
                    'BACKEND': (
                        'django.contrib.staticfiles.storage.StaticFilesStorage'
                    ),
                },
            },
        )
        self.storage_override.enable()
        self.addCleanup(self.storage_override.disable)

        self.user = User.objects.create_user(
            email='chat-attachments@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        token = '123456789:AAExample_bot_token-with-safe_chars'
        WorkspaceIntegration.objects.create(
            workspace=self.user.workspace,
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
            config=encrypt_integration_secret(
                secret=token,
                workspace_id=self.user.workspace_id,
                integration_type=IntegrationType.TELEGRAM,
            ),
        )
        self.contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Клиент',
            telegram_user_id=7001,
            telegram_chat_id=7001,
        )
        self.chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=self.contact,
        )

    def _post(self, *, text='', attachment=None, key='attachment-message'):
        data = {'text': text}
        if attachment is not None:
            data['attachment'] = attachment
        return self.client.post(
            f'/api/chats/{self.chat.id}/messages',
            data,
            format='multipart',
            HTTP_IDEMPOTENCY_KEY=key,
        )

    def test_document_only_message_is_accepted_and_serialized(self):
        attachment = SimpleUploadedFile(
            'contract.pdf',
            b'%PDF-1.4 test',
            content_type='application/pdf',
        )

        response = self._post(attachment=attachment)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['text'], '')
        self.assertEqual(response.data['attachment']['type'], 'document')
        self.assertEqual(response.data['attachment']['name'], 'contract.pdf')
        self.assertEqual(
            response.data['attachment']['mime_type'],
            'application/pdf',
        )
        self.assertTrue(response.data['attachment']['url'])
        self.assertIsNone(response.data['attachment']['preview_url'])
        self.chat.refresh_from_db()
        self.assertEqual(self.chat.last_message, '[Документ] contract.pdf')

    def test_image_message_has_preview_url(self):
        attachment = SimpleUploadedFile(
            'photo.png',
            b'not-a-real-png-but-storage-does-not-care',
            content_type='image/png',
        )

        response = self._post(
            text='Фото',
            attachment=attachment,
            key='image-message',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['attachment']['type'], 'image')
        self.assertEqual(
            response.data['attachment']['preview_url'],
            response.data['attachment']['url'],
        )

    def test_message_without_text_or_attachment_is_rejected(self):
        response = self._post(key='empty-message')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @patch('messaging.views.MAX_ATTACHMENT_SIZE', 1)
    def test_attachment_larger_than_limit_returns_413(self):
        attachment = SimpleUploadedFile(
            'large.pdf',
            b'xx',
            content_type='application/pdf',
        )

        response = self._post(
            attachment=attachment,
            key='large-message',
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )
        self.assertEqual(response.data['error'], 'attachment_too_large')

    def test_idempotency_hash_includes_attachment(self):
        first = self._post(
            attachment=SimpleUploadedFile(
                'first.pdf',
                b'first',
                content_type='application/pdf',
            ),
            key='same-key',
        )
        second = self._post(
            attachment=SimpleUploadedFile(
                'second.pdf',
                b'second',
                content_type='application/pdf',
            ),
            key='same-key',
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.data['error'], 'idempotency_conflict')

    def test_document_is_delivered_with_telegram_send_document(self):
        response = self._post(
            text='Договор',
            attachment=SimpleUploadedFile(
                'contract.pdf',
                b'%PDF-1.4 test',
                content_type='application/pdf',
            ),
            key='telegram-document',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        message = Message.objects.get(id=response.data['id'])
        telegram = Mock()
        telegram.send_document.return_value = {'message_id': 12345}

        processed = process_outgoing_message(message.id, client=telegram)

        self.assertTrue(processed)
        telegram.send_document.assert_called_once()
        telegram.send_message.assert_not_called()
        kwargs = telegram.send_document.call_args.kwargs
        self.assertEqual(kwargs['chat_id'], self.contact.telegram_chat_id)
        self.assertEqual(kwargs['filename'], 'contract.pdf')
        self.assertEqual(kwargs['content_type'], 'application/pdf')
        self.assertEqual(kwargs['caption'], 'Договор')
        message.refresh_from_db()
        self.assertEqual(message.attachment_type, MessageAttachmentType.DOCUMENT)
        self.assertEqual(message.status, MessageStatus.DELIVERED)
