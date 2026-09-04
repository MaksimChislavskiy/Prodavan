from django.test import TestCase, override_settings

from ai_assistant.models import AIAutomationEvent, AutomationEventStatus
from contacts.models import Contact, ContactAuditAction, ContactAuditLog
from notifications.models import Notification
from users.models import User
from workspaces.models import TelegramWebhookLog

from .models import Chat, Message
from .telegram import process_telegram_webhook_log


DUPLICATE_WARNING = (
    'Обнаружен существующий контакт. Возможно, требуется объединение данных.'
)


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class NewTzContactCreationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='section8-telegram@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

    def _webhook(self, *, update_id, user_id, username, text):
        return TelegramWebhookLog.objects.create(
            workspace=self.user.workspace,
            update_id=update_id,
            payload={
                'update_id': update_id,
                'message': {
                    'message_id': update_id,
                    'from': {
                        'id': user_id,
                        'is_bot': False,
                        'first_name': 'Новый',
                        'last_name': 'Клиент',
                        'username': username,
                    },
                    'chat': {'id': user_id, 'type': 'private'},
                    'text': text,
                },
            },
        )

    def test_active_phone_duplicate_is_reused_without_business_mutation_and_warns(self):
        existing = Contact.objects.create(
            workspace=self.user.workspace,
            name='Существующий Иван',
            company='ООО Существующая',
            phone='+79990001122',
            email='old@example.com',
            telegram=None,
            telegram_username=None,
            version=4,
        )
        original_updated_at = existing.updated_at
        log = self._webhook(
            update_id=801,
            user_id=88001,
            username='new_telegram_user',
            text='Здравствуйте. Мой телефон +79990001122, компания ООО Новая.',
        )

        self.assertTrue(process_telegram_webhook_log(log.id))

        existing.refresh_from_db()
        self.assertEqual(Contact.objects.filter(workspace=self.user.workspace).count(), 1)
        self.assertEqual(existing.name, 'Существующий Иван')
        self.assertEqual(existing.company, 'ООО Существующая')
        self.assertEqual(existing.phone, '+79990001122')
        self.assertEqual(existing.email, 'old@example.com')
        self.assertIsNone(existing.telegram)
        self.assertIsNone(existing.telegram_username)
        self.assertEqual(existing.version, 4)
        self.assertEqual(existing.updated_at, original_updated_at)
        self.assertEqual(existing.telegram_user_id, 88001)
        self.assertEqual(existing.telegram_chat_id, 88001)

        chat = Chat.objects.get(workspace=self.user.workspace)
        self.assertEqual(chat.contact_id, existing.id)
        event = AIAutomationEvent.objects.get(message__chat=chat)
        self.assertEqual(event.status, AutomationEventStatus.IGNORED)
        self.assertEqual(event.analysis, {'contact_duplicate_detected': True})
        self.assertFalse(
            ContactAuditLog.objects.filter(
                workspace=self.user.workspace,
                contact_identifier=existing.id,
                action__in=(ContactAuditAction.CREATED, ContactAuditAction.UPDATED),
            ).exists(),
        )
        self.assertTrue(
            Notification.objects.filter(
                workspace=self.user.workspace,
                user=self.user,
                content=DUPLICATE_WARNING,
                entity_type='contact',
                entity_id=str(existing.id),
            ).exists(),
        )

    def test_active_email_duplicate_is_reused_and_warns(self):
        existing = Contact.objects.create(
            workspace=self.user.workspace,
            name='Контакт по email',
            email='duplicate@example.com',
            version=2,
        )
        log = self._webhook(
            update_id=802,
            user_id=88002,
            username='email_duplicate',
            text='Напишите мне на duplicate@example.com',
        )

        self.assertTrue(process_telegram_webhook_log(log.id))

        existing.refresh_from_db()
        self.assertEqual(Contact.objects.filter(workspace=self.user.workspace).count(), 1)
        self.assertEqual(existing.email, 'duplicate@example.com')
        self.assertEqual(existing.version, 2)
        self.assertIsNone(existing.telegram)
        self.assertTrue(
            Notification.objects.filter(
                user=self.user,
                content=DUPLICATE_WARNING,
            ).exists(),
        )
        self.assertEqual(
            AIAutomationEvent.objects.get(message__chat__contact=existing).status,
            AutomationEventStatus.IGNORED,
        )

    def test_soft_deleted_phone_match_does_not_block_new_contact(self):
        deleted = Contact.objects.create(
            workspace=self.user.workspace,
            name='Удалённый контакт',
            phone='+79990003344',
            is_deleted=True,
        )
        log = self._webhook(
            update_id=803,
            user_id=88003,
            username='fresh_contact',
            text='Здравствуйте, мой телефон +79990003344',
        )

        self.assertTrue(process_telegram_webhook_log(log.id))

        deleted.refresh_from_db()
        self.assertTrue(deleted.is_deleted)
        active = Contact.objects.get(
            workspace=self.user.workspace,
            is_deleted=False,
        )
        self.assertNotEqual(active.id, deleted.id)
        self.assertEqual(active.phone, '+79990003344')
        self.assertEqual(active.name, 'Новый Клиент')
        self.assertEqual(active.telegram, '@fresh_contact')
        self.assertEqual(Message.objects.filter(chat__contact=active).count(), 1)
        self.assertFalse(
            Notification.objects.filter(
                user=self.user,
                content=DUPLICATE_WARNING,
            ).exists(),
        )
        created_audit = ContactAuditLog.objects.get(
            workspace=self.user.workspace,
            contact_identifier=active.id,
            action=ContactAuditAction.CREATED,
        )
        self.assertEqual(created_audit.changes['source'], 'ai')
