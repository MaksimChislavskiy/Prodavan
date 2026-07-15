import json
from datetime import timedelta
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact, ContactAuditAction, ContactAuditLog
from notifications.models import Notification, NotificationType
from users.models import User, UserRole
from workspaces.crypto import encrypt_integration_secret
from workspaces.models import (
    IntegrationStatus,
    IntegrationType,
    TelegramWebhookLog,
    WorkspaceAuditLog,
    WorkspaceIntegration,
)
from workspaces.telegram import TelegramApiUnavailable, TelegramMessageRejected

from .models import (
    Chat,
    ChatAuditAction,
    ChatAuditLog,
    Message,
    MessageIdempotencyRecord,
    MessageSenderType,
    MessageStatus,
)
from .outgoing import process_outgoing_message
from .telegram import (
    process_pending_telegram_webhooks,
    process_telegram_webhook_log,
)


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    CHAT_RETURNED_AFTER_DAYS=7,
)
class MessagingTests(TestCase):
    login_url = '/api/auth/login'

    def setUp(self):
        cache.clear()
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

    def _connect_telegram(self):
        token = '123456789:AAExample_bot_token-with-safe_chars'
        return WorkspaceIntegration.objects.create(
            workspace=self.user.workspace,
            type=IntegrationType.TELEGRAM,
            status=IntegrationStatus.CONNECTED,
            config=encrypt_integration_secret(
                secret=token,
                workspace_id=self.user.workspace_id,
                integration_type=IntegrationType.TELEGRAM,
            ),
        )

    def _enqueue(self, chat, text='Добрый день', key='message-key'):
        return self.client.post(
            f'/api/chats/{chat.id}/messages',
            {'text': text},
            format='json',
            HTTP_IDEMPOTENCY_KEY=key,
            **self._auth(),
        )

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
        self.assertEqual(contact.comment, 'Создан AI из чата')
        contact_audit = ContactAuditLog.objects.get(
            contact_identifier=contact.id,
            action=ContactAuditAction.CREATED,
        )
        self.assertEqual(
            contact_audit.changes,
            {
                'source': 'ai',
                'trigger': 'first_message',
                'channel': 'telegram',
            },
        )
        self.assertIsNotNone(contact_audit.correlation_id)
        chat = Chat.objects.get(workspace=self.user.workspace)
        self.assertEqual(chat.contact, contact)
        self.assertEqual(chat.last_message, 'Здравствуйте')
        self.assertEqual(chat.unread_count, 1)
        message = Message.objects.get(chat=chat)
        self.assertEqual(message.sender_type, MessageSenderType.CONTACT)
        self.assertIsNone(message.status)
        self.assertEqual(message.source_update_id, 100)
        self.assertEqual(message.telegram_message_id, 100)
        audit = ChatAuditLog.objects.get(
            action=ChatAuditAction.TELEGRAM_MESSAGE_RECEIVED,
            message_identifier=message.id,
        )
        self.assertIsNone(audit.user)
        self.assertEqual(
            audit.details,
            {
                'update_id': 100,
                'telegram_message_id': 100,
                'telegram_chat_id': 777000,
                'telegram_user_id': 777000,
            },
        )
        self.assertNotIn('text', audit.details)
        notification = Notification.objects.get(user=self.user)
        self.assertEqual(notification.type, NotificationType.CHAT_NEW_MESSAGE)
        self.assertEqual(notification.entity_type, 'chat')
        self.assertEqual(notification.entity_id, str(chat.id))
        self.assertEqual(notification.link, f'/chat/{chat.id}')
        self.assertIn('Пётр Петров', notification.content)
        self.assertIn('Здравствуйте', notification.content)

    def test_first_message_extracts_contact_phone_and_email(self):
        webhook_log = self._webhook_log(
            text=(
                'Свяжитесь со мной: client@example.com, '
                '8 (999) 123-45-67.'
            ),
        )

        process_telegram_webhook_log(webhook_log.id)

        contact = Contact.objects.get(workspace=self.user.workspace)
        self.assertEqual(contact.email, 'client@example.com')
        self.assertEqual(contact.phone, '+79991234567')

    def test_first_message_reuses_contact_by_email(self):
        existing = Contact.objects.create(
            workspace=self.user.workspace,
            name='Существующий клиент',
            email='client@example.com',
        )
        webhook_log = self._webhook_log(
            text='Моя почта client@example.com, хочу продолжить обсуждение.',
        )

        process_telegram_webhook_log(webhook_log.id)

        self.assertEqual(Contact.objects.count(), 1)
        existing.refresh_from_db()
        self.assertEqual(existing.telegram_user_id, 777000)
        self.assertEqual(existing.telegram_chat_id, 777000)
        self.assertEqual(Chat.objects.get().contact, existing)
        self.assertFalse(
            ContactAuditLog.objects.filter(
                action=ContactAuditAction.CREATED,
            ).exists(),
        )

    def test_first_message_reuses_contact_by_normalized_phone(self):
        existing = Contact.objects.create(
            workspace=self.user.workspace,
            name='Существующий клиент',
            phone='+79991234567',
        )
        webhook_log = self._webhook_log(
            text='Мой номер 8 (999) 123-45-67, перезвоните.',
        )

        process_telegram_webhook_log(webhook_log.id)

        self.assertEqual(Contact.objects.count(), 1)
        existing.refresh_from_db()
        self.assertEqual(existing.telegram_user_id, 777000)
        self.assertEqual(Chat.objects.get().contact, existing)

    def test_first_message_contact_matching_is_workspace_scoped(self):
        other = User.objects.create_user(
            email='other-contact-owner@example.com',
            password='StrongPass2',
            first_name='Олег',
            last_name='Другой',
            is_confirmed=True,
        )
        foreign_contact = Contact.objects.create(
            workspace=other.workspace,
            name='Контакт другого workspace',
            email='client@example.com',
        )
        webhook_log = self._webhook_log(
            text='Моя почта client@example.com.',
        )

        process_telegram_webhook_log(webhook_log.id)

        own_contact = Contact.objects.get(workspace=self.user.workspace)
        self.assertNotEqual(own_contact.id, foreign_contact.id)
        self.assertEqual(own_contact.email, 'client@example.com')
        self.assertEqual(Chat.objects.get().contact, own_contact)

    def test_incoming_message_notifies_active_workspace_users_only(self):
        teammate = User.objects.create_user(
            email='teammate@example.com',
            password='StrongPass1',
            first_name='Анна',
            last_name='Иванова',
            is_confirmed=True,
            workspace=self.user.workspace,
        )
        other = User.objects.create_user(
            email='other-workspace@example.com',
            password='StrongPass1',
            first_name='Олег',
            last_name='Другой',
            is_confirmed=True,
        )
        webhook_log = self._webhook_log(text='Нужна консультация')

        process_telegram_webhook_log(webhook_log.id)

        notifications = Notification.objects.order_by('user__email')
        self.assertEqual(notifications.count(), 2)
        self.assertEqual(
            {item.user_id for item in notifications},
            {self.user.id, teammate.id},
        )
        self.assertFalse(Notification.objects.filter(user=other).exists())

    def test_incoming_messages_are_aggregated_per_chat_for_one_minute(self):
        first = self._webhook_log(update_id=101, text='Первое сообщение')
        second = self._webhook_log(update_id=102, text='Второе сообщение')

        process_telegram_webhook_log(first.id)
        process_telegram_webhook_log(second.id)

        notification = Notification.objects.get(user=self.user)
        self.assertEqual(notification.type, NotificationType.CHAT_NEW_MESSAGE)
        self.assertIn('Второе сообщение', notification.content)
        self.assertEqual(Message.objects.count(), 2)

    def test_old_chat_creates_client_returned_notification(self):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Пётр Петров',
            telegram_user_id=777000,
            telegram_chat_id=777000,
        )
        chat = Chat.objects.create(
            workspace=self.user.workspace,
            contact=contact,
            last_message='До связи',
            last_message_at=timezone.now() - timedelta(days=8),
        )
        webhook_log = self._webhook_log(
            update_id=103,
            text='Я снова вернулся к вопросу',
        )

        process_telegram_webhook_log(webhook_log.id)

        notification = Notification.objects.get(user=self.user)
        self.assertEqual(notification.type, NotificationType.CHAT_RETURNED)
        self.assertEqual(notification.title, 'Клиент вернулся')
        self.assertEqual(notification.entity_id, str(chat.id))
        self.assertEqual(notification.link, f'/chat/{chat.id}')
        self.assertIn('Пётр Петров', notification.content)
        self.assertIn('снова вышел на связь', notification.content)
        self.assertFalse(
            Notification.objects.filter(
                type=NotificationType.CHAT_NEW_MESSAGE,
            ).exists(),
        )

    def test_recent_existing_chat_keeps_new_message_notification(self):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Пётр Петров',
            telegram_user_id=777000,
            telegram_chat_id=777000,
        )
        Chat.objects.create(
            workspace=self.user.workspace,
            contact=contact,
            last_message='Недавнее сообщение',
            last_message_at=timezone.now() - timedelta(days=6),
        )
        webhook_log = self._webhook_log(
            update_id=104,
            text='Продолжим обсуждение',
        )

        process_telegram_webhook_log(webhook_log.id)

        notification = Notification.objects.get(user=self.user)
        self.assertEqual(notification.type, NotificationType.CHAT_NEW_MESSAGE)
        self.assertFalse(
            Notification.objects.filter(
                type=NotificationType.CHAT_RETURNED,
            ).exists(),
        )

    @patch('messaging.telegram.broadcast_workspace_event')
    def test_incoming_message_schedules_realtime_events(self, broadcast):
        webhook_log = self._webhook_log()

        with self.captureOnCommitCallbacks(execute=True):
            process_telegram_webhook_log(webhook_log.id)

        events = [call.args[1]['event'] for call in broadcast.call_args_list]
        self.assertEqual(events, ['chat_created', 'message_new'])

    def test_processed_webhook_is_idempotent(self):
        webhook_log = self._webhook_log()
        process_telegram_webhook_log(webhook_log.id)

        processed_again = process_telegram_webhook_log(webhook_log.id)

        self.assertFalse(processed_again)
        webhook_log.refresh_from_db()
        self.assertEqual(webhook_log.processing_attempts, 1)
        self.assertEqual(Message.objects.count(), 1)
        self.assertEqual(
            ChatAuditLog.objects.filter(
                action=ChatAuditAction.TELEGRAM_MESSAGE_RECEIVED,
            ).count(),
            1,
        )

    def test_non_message_webhook_does_not_write_message_audit(self):
        webhook_log = TelegramWebhookLog.objects.create(
            workspace=self.user.workspace,
            update_id=105,
            payload={
                'update_id': 105,
                'callback_query': {'id': 'callback-1'},
            },
        )

        processed = process_telegram_webhook_log(webhook_log.id)

        self.assertTrue(processed)
        webhook_log.refresh_from_db()
        self.assertTrue(webhook_log.processed)
        self.assertFalse(Message.objects.exists())
        self.assertFalse(
            ChatAuditLog.objects.filter(
                action=ChatAuditAction.TELEGRAM_MESSAGE_RECEIVED,
            ).exists(),
        )

    @patch('messaging.telegram.process_telegram_webhook_log')
    def test_webhook_queue_stops_after_three_failures_and_audits(self, process):
        process.side_effect = RuntimeError('sensitive failure details')
        webhook_log = self._webhook_log(update_id=909)

        first = process_pending_telegram_webhooks()
        second = process_pending_telegram_webhooks()
        third = process_pending_telegram_webhooks()
        fourth = process_pending_telegram_webhooks()

        webhook_log.refresh_from_db()
        self.assertEqual(first['failed'], 1)
        self.assertEqual(second['failed'], 1)
        self.assertEqual(third['failed'], 1)
        self.assertEqual(third['permanently_failed'], 1)
        self.assertEqual(
            fourth,
            {'processed': 0, 'failed': 0, 'permanently_failed': 0},
        )
        self.assertEqual(process.call_count, 3)
        self.assertEqual(webhook_log.processing_attempts, 3)
        self.assertIsNotNone(webhook_log.failed_at)
        self.assertFalse(webhook_log.processed)
        self.assertIn('sensitive failure details', webhook_log.processing_error)

        audits = WorkspaceAuditLog.objects.filter(
            workspace=self.user.workspace,
            field='telegram_webhook_failed',
        ).order_by('changed_at', 'id')
        self.assertEqual(audits.count(), 3)
        details = [json.loads(audit.new_value) for audit in audits]
        self.assertEqual(
            [item['attempt'] for item in details],
            [1, 2, 3],
        )
        self.assertEqual(
            [item['final'] for item in details],
            [False, False, True],
        )
        self.assertTrue(all(item['update_id'] == 909 for item in details))
        self.assertTrue(
            all(item['error_type'] == 'RuntimeError' for item in details),
        )
        self.assertNotIn(
            'sensitive failure details',
            ''.join(audit.new_value for audit in audits),
        )

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

    def test_chat_settings_endpoint_updates_autopilot_override(self):
        _, chat = self._contact_and_chat()

        disabled = self.client.patch(
            f'/api/chats/{chat.id}/settings',
            {'ai_autopilot_enabled': False},
            format='json',
            **self._auth(),
        )
        inherited = self.client.patch(
            f'/api/chats/{chat.id}/settings',
            {'ai_autopilot_enabled': None},
            format='json',
            **self._auth(),
        )

        self.assertEqual(disabled.status_code, status.HTTP_200_OK)
        self.assertFalse(disabled.data['ai_autopilot_enabled'])
        self.assertEqual(inherited.status_code, status.HTTP_200_OK)
        self.assertIsNone(inherited.data['ai_autopilot_enabled'])
        chat.refresh_from_db()
        self.assertIsNone(chat.ai_autopilot_enabled)

    def test_disabling_chat_autopilot_writes_idempotent_telegram_audit(self):
        _, chat = self._contact_and_chat()
        url = f'/api/chats/{chat.id}/settings'

        first = self.client.patch(
            url,
            {'ai_autopilot_enabled': False},
            format='json',
            **self._auth(),
        )
        second = self.client.patch(
            url,
            {'ai_autopilot_enabled': False},
            format='json',
            **self._auth(),
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        logs = WorkspaceAuditLog.objects.filter(
            workspace=self.user.workspace,
            field='telegram_autopilot_disabled_for_chat',
        )
        self.assertEqual(logs.count(), 1)
        log = logs.get()
        self.assertEqual(log.user, self.user)
        self.assertEqual(
            json.loads(log.old_value),
            {
                'chat_id': str(chat.id),
                'ai_autopilot_enabled': None,
            },
        )
        self.assertEqual(
            json.loads(log.new_value),
            {
                'chat_id': str(chat.id),
                'ai_autopilot_enabled': False,
            },
        )

    def test_chat_settings_endpoint_validates_payload(self):
        _, chat = self._contact_and_chat()

        response = self.client.patch(
            f'/api/chats/{chat.id}/settings',
            {'enabled': False},
            format='json',
            **self._auth(),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('enabled', response.data['errors'])

    def test_chat_settings_endpoint_is_workspace_scoped(self):
        other = User.objects.create_user(
            email='other@example.com',
            password='StrongPass1',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        contact = Contact.objects.create(
            workspace=other.workspace,
            name='Чужой контакт',
        )
        chat = Chat.objects.create(workspace=other.workspace, contact=contact)

        response = self.client.patch(
            f'/api/chats/{chat.id}/settings',
            {'ai_autopilot_enabled': False},
            format='json',
            **self._auth(),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(
            WorkspaceAuditLog.objects.filter(
                workspace=self.user.workspace,
                field='telegram_autopilot_disabled_for_chat',
            ).exists(),
        )

    def test_chat_endpoints_require_authentication(self):
        response = APIClient().get('/api/chats')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_outgoing_message_requires_idempotency_key(self):
        self._connect_telegram()
        _, chat = self._contact_and_chat()

        response = self.client.post(
            f'/api/chats/{chat.id}/messages',
            {'text': 'Добрый день'},
            format='json',
            **self._auth(),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'missing_idempotency_key')

    def test_outgoing_message_is_queued_and_idempotent(self):
        self._connect_telegram()
        _, chat = self._contact_and_chat()

        created = self._enqueue(chat)
        replayed = self._enqueue(chat)
        conflict = self._enqueue(chat, text='Другой текст')

        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(created.data['status'], MessageStatus.SENT)
        self.assertEqual(replayed.status_code, status.HTTP_200_OK)
        self.assertEqual(replayed.data['id'], created.data['id'])
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(conflict.data['error'], 'idempotency_conflict')
        self.assertEqual(Message.objects.count(), 1)
        self.assertEqual(MessageIdempotencyRecord.objects.count(), 1)

    @patch('messaging.outgoing.broadcast_workspace_event')
    def test_outgoing_message_schedules_realtime_event(self, broadcast):
        self._connect_telegram()
        _, chat = self._contact_and_chat()

        with self.captureOnCommitCallbacks(execute=True):
            response = self._enqueue(chat)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payload = broadcast.call_args.args[1]
        self.assertEqual(payload['event'], 'message_new')
        self.assertEqual(payload['message']['status'], MessageStatus.SENT)

    def test_outgoing_delivery_marks_message_delivered(self):
        self._connect_telegram()
        _, chat = self._contact_and_chat()
        response = self._enqueue(chat)
        client = Mock()
        client.send_message.return_value = {'message_id': 987}

        processed = process_outgoing_message(response.data['id'], client=client)

        self.assertTrue(processed)
        message = Message.objects.get(id=response.data['id'])
        self.assertEqual(message.status, MessageStatus.DELIVERED)
        self.assertEqual(message.telegram_message_id, 987)
        self.assertEqual(message.delivery_attempts, 1)
        self.assertIsNotNone(message.delivered_at)
        client.send_message.assert_called_once()
        audit = ChatAuditLog.objects.get(
            action=ChatAuditAction.TELEGRAM_MESSAGE_SENT,
            message_identifier=message.id,
        )
        self.assertEqual(audit.user, self.user)
        self.assertEqual(
            audit.details,
            {
                'status': MessageStatus.DELIVERED,
                'sent_by_ai': False,
                'telegram_message_id': 987,
                'delivery_attempts': 1,
            },
        )

        repeated = process_outgoing_message(message.id, client=client)

        self.assertFalse(repeated)
        self.assertEqual(
            ChatAuditLog.objects.filter(
                action=ChatAuditAction.TELEGRAM_MESSAGE_SENT,
                message_identifier=message.id,
            ).count(),
            1,
        )

    def test_ai_delivery_audit_includes_sent_by_ai(self):
        self._connect_telegram()
        _, chat = self._contact_and_chat()
        message = Message.objects.create(
            chat=chat,
            sender_type=MessageSenderType.USER,
            sender_id=self.user.id,
            text='Автоматический ответ',
            status=MessageStatus.SENT,
            sent_by_ai=True,
            next_delivery_attempt_at=timezone.now(),
        )
        client = Mock()
        client.send_message.return_value = {'message_id': 654}

        processed = process_outgoing_message(message.id, client=client)

        self.assertTrue(processed)
        audit = ChatAuditLog.objects.get(
            action=ChatAuditAction.TELEGRAM_MESSAGE_SENT,
            message_identifier=message.id,
        )
        self.assertIsNone(audit.user)
        self.assertTrue(audit.details['sent_by_ai'])
        self.assertNotIn('text', audit.details)

    def test_temporary_delivery_error_retries_three_times(self):
        self._connect_telegram()
        _, chat = self._contact_and_chat()
        admin = User.objects.create_user(
            email='delivery-admin@example.com',
            password='StrongPass2',
            first_name='Анна',
            last_name='Администратор',
            workspace=self.user.workspace,
            is_confirmed=True,
            role=UserRole.ADMIN,
        )
        regular = User.objects.create_user(
            email='delivery-user@example.com',
            password='StrongPass3',
            first_name='Пётр',
            last_name='Пользователь',
            workspace=self.user.workspace,
            is_confirmed=True,
            role=UserRole.USER,
        )
        response = self._enqueue(chat)
        client = Mock()
        client.send_message.side_effect = TelegramApiUnavailable('offline')
        message_id = response.data['id']

        process_outgoing_message(message_id, client=client)
        message = Message.objects.get(id=message_id)
        self.assertEqual(message.status, MessageStatus.SENT)
        self.assertEqual(message.delivery_attempts, 1)

        process_outgoing_message(
            message_id,
            client=client,
            now=message.next_delivery_attempt_at,
        )
        message.refresh_from_db()
        self.assertEqual(message.status, MessageStatus.SENT)
        self.assertEqual(message.delivery_attempts, 2)

        process_outgoing_message(
            message_id,
            client=client,
            now=message.next_delivery_attempt_at,
        )
        message.refresh_from_db()
        self.assertEqual(message.status, MessageStatus.FAILED)
        self.assertEqual(message.delivery_attempts, 3)
        self.assertIsNone(message.next_delivery_attempt_at)
        notifications = Notification.objects.filter(
            type=NotificationType.CHAT_MESSAGE_DELIVERY_FAILED,
            entity_type='message',
            entity_id=str(message.id),
        )
        self.assertEqual(
            {notification.user_id for notification in notifications},
            {self.user.id, admin.id},
        )
        self.assertFalse(notifications.filter(user=regular).exists())
        notification = notifications.get(user=self.user)
        self.assertEqual(notification.link, f'/chat/{chat.id}')
        self.assertIn('не доставлено через Telegram', notification.content)

        repeated = process_outgoing_message(message_id, client=client)

        self.assertFalse(repeated)
        self.assertEqual(notifications.count(), 2)
        self.assertFalse(
            ChatAuditLog.objects.filter(
                action=ChatAuditAction.TELEGRAM_MESSAGE_SENT,
                message_identifier=message.id,
            ).exists(),
        )

    def test_permanent_delivery_error_fails_without_retry(self):
        self._connect_telegram()
        _, chat = self._contact_and_chat()
        response = self._enqueue(chat)
        client = Mock()
        client.send_message.side_effect = TelegramMessageRejected('blocked')

        process_outgoing_message(response.data['id'], client=client)

        message = Message.objects.get(id=response.data['id'])
        self.assertEqual(message.status, MessageStatus.FAILED)
        self.assertEqual(message.delivery_attempts, 1)
        self.assertIsNone(message.next_delivery_attempt_at)
        notification = Notification.objects.get(
            user=self.user,
            type=NotificationType.CHAT_MESSAGE_DELIVERY_FAILED,
            entity_type='message',
            entity_id=str(message.id),
        )
        self.assertEqual(notification.link, f'/chat/{message.chat_id}')

    def test_outgoing_message_text_is_validated(self):
        self._connect_telegram()
        _, chat = self._contact_and_chat()

        response = self._enqueue(chat, text='   ')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('text', response.data['errors'])

    def test_outgoing_messages_are_rate_limited_per_workspace(self):
        self._connect_telegram()
        _, chat = self._contact_and_chat()

        for index in range(20):
            response = self._enqueue(chat, key=f'key-{index}')
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        response = self._enqueue(chat, key='key-over-limit')

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.data['error'], 'rate_limit_exceeded')
