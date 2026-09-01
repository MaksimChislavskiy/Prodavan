from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact, ContactAuditAction, ContactAuditLog
from deals.models import ChangedByType, Deal, DealEvent, DealHistory, SalesStage
from messaging.models import (
    Chat,
    ChatAuditAction,
    ChatAuditLog,
    Message,
    MessageSenderType,
    MessageStatus,
)
from tasks.models import Task, TaskAuditLog, TaskEvent, TaskHistory, TaskSource

from .models import RefreshToken, User


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class NewTzProfileDeleteTests(TestCase):
    profile_url = '/api/profile'
    login_url = '/api/auth/login'

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='owner-delete@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.workspace = self.user.workspace
        self.stage = SalesStage.objects.create(
            workspace=self.workspace,
            name='Новый лид',
            is_system=True,
            order=1,
        )
        self.contact = Contact.objects.create(
            workspace=self.workspace,
            name='Клиент',
        )
        self.deal = Deal.objects.create(
            workspace=self.workspace,
            stage=self.stage,
            contact=self.contact,
            name='Тестовая сделка',
        )
        self.task = Task.objects.create(
            workspace=self.workspace,
            title='Тестовая задача',
            created_by_user=self.user,
        )
        self.chat = Chat.objects.create(
            workspace=self.workspace,
            contact=self.contact,
        )
        self.message = Message.objects.create(
            chat=self.chat,
            sender_type=MessageSenderType.USER,
            sender_id=self.user.id,
            text='Сообщение пользователя',
            status=MessageStatus.SENT,
        )
        self.deal_history = DealHistory.objects.create(
            workspace=self.workspace,
            deal=self.deal,
            event_type=DealEvent.CREATED,
            changed_by_type=ChangedByType.USER,
            changed_by=self.user,
        )
        self.contact_audit = ContactAuditLog.objects.create(
            workspace=self.workspace,
            user=self.user,
            action=ContactAuditAction.CREATED,
            contact_identifier=self.contact.id,
        )
        self.task_history = TaskHistory.objects.create(
            workspace=self.workspace,
            task=self.task,
            event=TaskEvent.CREATED,
            source=TaskSource.USER,
            user=self.user,
        )
        self.task_audit = TaskAuditLog.objects.create(
            workspace=self.workspace,
            task_identifier=self.task.id,
            event=TaskEvent.CREATED,
            source=TaskSource.USER,
            user=self.user,
        )
        self.chat_audit = ChatAuditLog.objects.create(
            workspace=self.workspace,
            user=self.user,
            action=ChatAuditAction.MESSAGE_SENT,
            chat_identifier=self.chat.id,
            message_identifier=self.message.id,
        )

    def _login(self):
        response = self.client.post(
            self.login_url,
            {
                'email': self.user.email,
                'password': 'StrongPass1',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data['access_token']

    def test_delete_profile_deactivates_workspace_and_reassigns_authorship(self):
        access_token = self._login()
        self.assertTrue(
            RefreshToken.objects.filter(user=self.user, revoked=False).exists(),
        )

        response = self.client.delete(
            self.profile_url,
            {'version': self.user.version},
            format='json',
            HTTP_AUTHORIZATION=f'Bearer {access_token}',
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        self.user.refresh_from_db()
        self.workspace.refresh_from_db()
        self.task.refresh_from_db()
        self.message.refresh_from_db()
        self.deal_history.refresh_from_db()
        self.contact_audit.refresh_from_db()
        self.task_history.refresh_from_db()
        self.task_audit.refresh_from_db()
        self.chat_audit.refresh_from_db()

        deleted_system_user = User.objects.get(
            email='deleted-user@system.invalid',
        )

        self.assertFalse(self.user.is_active)
        self.assertTrue(self.user.is_deleted)
        self.assertIsNotNone(self.user.deleted_at)
        self.assertFalse(self.workspace.is_active)
        self.assertIsNotNone(self.workspace.deleted_at)
        self.assertFalse(
            RefreshToken.objects.filter(user=self.user, revoked=False).exists(),
        )

        self.assertEqual(self.task.created_by_user_id, deleted_system_user.id)
        self.assertEqual(self.message.sender_id, deleted_system_user.id)
        self.assertEqual(self.deal_history.changed_by_id, deleted_system_user.id)
        self.assertEqual(self.contact_audit.user_id, deleted_system_user.id)
        self.assertEqual(self.task_history.user_id, deleted_system_user.id)
        self.assertEqual(self.task_audit.user_id, deleted_system_user.id)
        self.assertEqual(self.chat_audit.user_id, deleted_system_user.id)

        self.assertTrue(Contact.objects.filter(id=self.contact.id).exists())
        self.assertTrue(Deal.objects.filter(id=self.deal.id).exists())
        self.assertTrue(Task.objects.filter(id=self.task.id).exists())
        self.assertTrue(Message.objects.filter(id=self.message.id).exists())
