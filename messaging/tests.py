from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from users.models import User
from workspaces.models import TelegramWebhookLog

from .models import (
    Chat,
    ChatAuditAction,
    ChatAuditLog,
    Message,
    MessageSenderType,
)
from .telegram import process_telegram_webhook_log


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class MessagingTests(TestCase):
    login_url = '/api/auth/login'

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        response = self.client.post(
            self.login_url,
            {'email': self.user.email, 'password': 'StrongPass1'},
            format='json',
        )
        self.access = response.data['access_token']

    def _auth(self):
        return {'HTTP_AUTHORIZATION': f'Bearer {self.access}'}

    def _webhook_log(self, update_id=100, **message_overrides):
        message = {
            'message_id': update_id,
            'from': {
                'id': 777000,
                'is_bot': False,
                'first_name': 'Пётр',
                'last_name': 'Петров',
                'username': 'petr_petrov',
            },
            'chat': {'id': 777000, 'type': 'private'},
            'text': 'Здравствуйте',
        }
        message.update(message_overrides)
        return TelegramWebhookLog.objects.create(
            workspace=self.user.workspace,
            update_id=update_id,
            payload={'update_id': update_id, 'message': message},
        )

    def _contact_and_chat(self):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Иван Петров',
            telegram_user_id=111,
            telegram_chat_id=111,
        )
        chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=contact,
        )
        return contact, chat

    def test_webhook_processing_creates_contact_chat_and_message(self):
        webhook_log = self._webhook_log()

        processed = process_telegram_webhook_log(webhook_log.id)

        self.assertTrue(processed)
        webhook_log.refresh_from_db()
        self.assertTrue(webhook_log.processed)
        contact = Contact.objects.get(workspace=self.user.workspace)
        self.assertEqual(contact.name, 'Пётр Петров')
        self.assertEqual(contact.telegram_user_id, 777000)
        self.assertEqual(contact.telegram, '@petr_petrov')
        chat = Chat.objects.get(workspace=self.user.workspace)
        self.assertEqual(chat.contact, contact)
        self.assertEqual(chat.last_message, 'Здравствуйте')
        self.assertEqual(chat.unread_count, 1)
        message = Message.objects.get(chat=chat)
        self.assertEqual(message.sender_type, MessageSenderType.CONTACT)
        self.assertIsNone(message.status)
        self.assertEqual(message.source_update_id, 100)
        self.assertTrue(
            ChatAuditLog.objects.filter(
                action=ChatAuditAction.MESSAGE_RECEIVED,
                message_identifier=message.id,
            ).exists(),
        )

    def test_processed_webhook_is_idempotent(self):
        webhook_log = self._webhook_log()
        process_telegram_webhook_log(webhook_log.id)

        processed_again = process_telegram_webhook_log(webhook_log.id)

        self.assertFalse(processed_again)
        self.assertEqual(Message.objects.count(), 1)

    def test_deleted_contact_is_reused_but_deleted_chat_is_not(self):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Старый контакт',
            telegram_user_id=777000,
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        deleted_chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=contact,
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        webhook_log = self._webhook_log()

        process_telegram_webhook_log(webhook_log.id)

        self.assertEqual(Contact.objects.count(), 1)
        contact.refresh_from_db()
        self.assertTrue(contact.is_deleted)
        active_chat = Chat.objects.get(is_deleted=False)
        self.assertEqual(active_chat.contact, contact)
        self.assertNotEqual(active_chat.id, deleted_chat.id)

    def test_media_webhook_is_saved_as_system_text(self):
        webhook_log = self._webhook_log(
            text=None,
            photo=[{'file_id': 'file'}],
            caption='Прайс',
        )

        process_telegram_webhook_log(webhook_log.id)

        self.assertEqual(Message.objects.get().text, '[Фото] Прайс')

    def test_chat_list_is_workspace_scoped_and_contains_deleted_contact(self):
        contact, chat = self._contact_and_chat()
        contact.is_deleted = True
        contact.deleted_at = timezone.now()
        contact.save(update_fields=('is_deleted', 'deleted_at', 'updated_at'))
        Chat.objects.filter(id=chat.id).update(
            last_message='Последнее сообщение',
            last_message_at=timezone.now(),
            unread_count=2,
        )
        other = User.objects.create_user(
            email='other@example.com',
            password='StrongPass1',
            first_name='Другой',
            last_name='Владелец',
            is_confirmed=True,
        )
        other_contact = Contact.objects.create(
            workspace=other.workspace,
            name='Чужой контакт',
        )
        Chat.objects.create(workspace=other.workspace, contact=other_contact)

        response = self.client.get('/api/chats', **self._auth())

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 1)
        self.assertTrue(response.data['chats'][0]['contact']['is_deleted'])
        self.assertEqual(response.data['chats'][0]['unread_count'], 2)

    def test_messages_use_opaque_cursor(self):
        contact, chat = self._contact_and_chat()
        for index in range(3):
            Message.objects.create(
                chat=chat,
                sender_type=MessageSenderType.CONTACT,
                sender_id=contact.id,
                text=f'Сообщение {index}',
            )

        first = self.client.get(
            f'/api/chats/{chat.id}/messages',
            {'limit': 2},
            **self._auth(),
        )
        second = self.client.get(
            f'/api/chats/{chat.id}/messages',
            {'limit': 2, 'cursor': first.data['next_cursor']},
            **self._auth(),
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(len(first.data['messages']), 2)
        self.assertTrue(first.data['has_more'])
        self.assertIsNotNone(first.data['next_cursor'])
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(len(second.data['messages']), 1)
        self.assertFalse(second.data['has_more'])

    def test_read_is_idempotent_and_resets_unread_count(self):
        contact, chat = self._contact_and_chat()
        chat.unread_count = 2
        chat.save(update_fields=('unread_count', 'updated_at'))
        for index in range(2):
            Message.objects.create(
                chat=chat,
                sender_type=MessageSenderType.CONTACT,
                sender_id=contact.id,
                text=f'Входящее {index}',
            )

        first = self.client.post(f'/api/chats/{chat.id}/read', **self._auth())
        second = self.client.post(f'/api/chats/{chat.id}/read', **self._auth())

        self.assertEqual(first.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(second.status_code, status.HTTP_204_NO_CONTENT)
        chat.refresh_from_db()
        self.assertEqual(chat.unread_count, 0)
        self.assertFalse(Message.objects.filter(read_at__isnull=True).exists())
        self.assertEqual(
            ChatAuditLog.objects.filter(
                action=ChatAuditAction.MESSAGE_READ,
            ).count(),
            1,
        )

    def test_delete_chat_soft_deletes_its_messages(self):
        contact, chat = self._contact_and_chat()
        message = Message.objects.create(
            chat=chat,
            sender_type=MessageSenderType.CONTACT,
            sender_id=contact.id,
            text='Входящее',
        )

        first = self.client.delete(f'/api/chats/{chat.id}', **self._auth())
        second = self.client.delete(f'/api/chats/{chat.id}', **self._auth())

        self.assertEqual(first.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(second.status_code, status.HTTP_404_NOT_FOUND)
        chat.refresh_from_db()
        message.refresh_from_db()
        self.assertTrue(chat.is_deleted)
        self.assertTrue(message.is_deleted)

    def test_chat_endpoints_require_authentication(self):
        response = APIClient().get('/api/chats')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
