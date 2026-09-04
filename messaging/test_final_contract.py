import uuid

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from users.models import User

from .models import Chat, Message, MessageSenderType


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class FinalChatContractTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='chat-final@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.other = User.objects.create_user(
            email='chat-final-other@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _chat(self, *, chat_id=None, workspace=None, name='Клиент'):
        workspace = workspace or self.user.workspace
        contact = Contact.objects.create(
            workspace=workspace,
            name=name,
        )
        return Chat.objects.create(
            id=chat_id or uuid.uuid4(),
            workspace=workspace,
            contact=contact,
        )

    def test_chat_list_tie_breaks_equal_last_message_at_by_id_desc(self):
        same_time = timezone.now()
        lower = self._chat(chat_id=uuid.UUID(int=1), name='Нижний id')
        higher = self._chat(chat_id=uuid.UUID(int=2), name='Верхний id')
        Chat.objects.filter(id__in=[lower.id, higher.id]).update(
            last_message='Сообщение',
            last_message_at=same_time,
        )

        response = self.client.get('/api/chats', {'page': 1, 'limit': 20})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [item['id'] for item in response.data['chats']],
            [str(higher.id), str(lower.id)],
        )

    def test_message_cursor_is_stable_for_equal_created_at(self):
        chat = self._chat()
        same_time = timezone.now()
        messages = []
        for value in (1, 2, 3):
            message = Message.objects.create(
                id=uuid.UUID(int=value),
                chat=chat,
                sender_type=MessageSenderType.CONTACT,
                sender_id=chat.contact_id,
                text=f'Сообщение {value}',
                status=None,
            )
            messages.append(message)
        Message.objects.filter(id__in=[item.id for item in messages]).update(
            created_at=same_time,
        )

        first = self.client.get(
            f'/api/chats/{chat.id}/messages',
            {'limit': 2},
        )
        second = self.client.get(
            f'/api/chats/{chat.id}/messages',
            {'limit': 2, 'cursor': first.data['next_cursor']},
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [item['id'] for item in first.data['messages']],
            [str(uuid.UUID(int=3)), str(uuid.UUID(int=2))],
        )
        self.assertEqual(
            [item['id'] for item in second.data['messages']],
            [str(uuid.UUID(int=1))],
        )
        self.assertEqual(
            len({
                *[item['id'] for item in first.data['messages']],
                *[item['id'] for item in second.data['messages']],
            }),
            3,
        )
        self.assertFalse(second.data['has_more'])

    def test_invalid_message_cursor_returns_validation_error(self):
        chat = self._chat()

        response = self.client.get(
            f'/api/chats/{chat.id}/messages',
            {'limit': 50, 'cursor': 'not-an-opaque-cursor'},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error']['code'], 'INVALID_CURSOR')

    def test_foreign_and_deleted_chats_are_hidden_from_object_endpoints(self):
        foreign = self._chat(
            workspace=self.other.workspace,
            name='Чужой клиент',
        )
        deleted = self._chat(name='Удалённый чат')
        Chat.objects.filter(id=deleted.id).update(
            is_deleted=True,
            deleted_at=timezone.now(),
        )

        for chat in (foreign, deleted):
            detail = self.client.get(f'/api/chats/{chat.id}')
            messages = self.client.get(f'/api/chats/{chat.id}/messages')
            read = self.client.post(f'/api/chats/{chat.id}/read')
            remove = self.client.delete(f'/api/chats/{chat.id}')

            self.assertEqual(detail.status_code, status.HTTP_404_NOT_FOUND)
            self.assertEqual(messages.status_code, status.HTTP_404_NOT_FOUND)
            self.assertEqual(read.status_code, status.HTTP_404_NOT_FOUND)
            self.assertEqual(remove.status_code, status.HTTP_404_NOT_FOUND)

    def test_idempotency_key_longer_than_255_characters_is_rejected(self):
        chat = self._chat()

        response = self.client.post(
            f'/api/chats/{chat.id}/messages',
            {'text': 'Добрый день'},
            format='json',
            HTTP_IDEMPOTENCY_KEY='x' * 256,
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error'], 'invalid_idempotency_key')

    def test_message_text_is_trimmed_and_whitespace_only_is_rejected(self):
        chat = self._chat()

        whitespace = self.client.post(
            f'/api/chats/{chat.id}/messages',
            {'text': '   '},
            format='json',
            HTTP_IDEMPOTENCY_KEY='whitespace-message',
        )

        self.assertEqual(whitespace.status_code, status.HTTP_400_BAD_REQUEST)
