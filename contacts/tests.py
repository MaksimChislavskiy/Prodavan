import uuid

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import Contact, ContactAuditAction, ContactAuditLog


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class ContactApiTests(TestCase):
    list_url = '/api/contacts'
    bulk_url = '/api/contacts/bulk'
    search_url = '/api/contacts/search'
    find_url = '/api/contacts/find-by-name'
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

    def _create(self, **overrides):
        payload = {'name': 'Иван Петров'}
        payload.update(overrides)
        return self.client.post(
            self.list_url,
            payload,
            format='json',
            **self._auth(),
        )

    def test_create_normalizes_fields_and_writes_audit(self):
        response = self._create(
            phone='8 (999) 123-45-67',
            email=' IVAN@EXAMPLE.COM ',
            telegram='@@ivan_123',
            comment='   ',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['phone'], '+79991234567')
        self.assertEqual(response.data['email'], 'ivan@example.com')
        self.assertEqual(response.data['telegram'], '@ivan_123')
        self.assertIsNone(response.data['comment'])
        audit = ContactAuditLog.objects.get(
            action=ContactAuditAction.CREATED,
        )
        self.assertEqual(audit.changes['source'], 'user')
        self.assertEqual(audit.user, self.user)

    def test_create_rejects_invalid_name_and_phone(self):
        response = self._create(name='Иван 123', phone='12')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['message'], 'Validation failed')
        self.assertIn('name', response.data['errors'])
        self.assertIn('phone', response.data['errors'])

    def test_list_is_stably_sorted_and_paginated(self):
        Contact.objects.create(workspace=self.user.workspace, name='борис')
        first = Contact.objects.create(
            workspace=self.user.workspace,
            name='  Анна ',
        )
        Contact.objects.create(workspace=self.user.workspace, name='Вера')

        response = self.client.get(
            self.list_url,
            {'page': 1, 'limit': 2},
            **self._auth(),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 3)
        self.assertEqual(response.data['limit'], 2)
        self.assertEqual(response.data['contacts'][0]['id'], str(first.id))
        self.assertEqual(len(response.data['contacts']), 2)

    def test_list_rejects_unsupported_sort_and_large_limit(self):
        bad_sort = self.client.get(
            self.list_url,
            {'sort': 'created_at:desc'},
            **self._auth(),
        )
        bad_limit = self.client.get(
            self.list_url,
            {'limit': 101},
            **self._auth(),
        )

        self.assertEqual(bad_sort.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(bad_limit.status_code, status.HTTP_400_BAD_REQUEST)

    def test_detail_hides_contacts_from_another_workspace(self):
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

        response = self.client.get(
            f'/api/contacts/{contact.id}',
            **self._auth(),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_detail_includes_ai_insights(self):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='AI Контакт',
            ai_insights={
                'needs': 'CRM для продаж',
                'budget': '120000 RUB',
                'timeline': None,
                'objections': ['Цена'],
                'next_step': 'Отправить КП',
                'probability': 70,
                'last_analyzed_at': '2026-07-09T12:00:00+00:00',
                'confidence': 0.8,
            },
        )

        response = self.client.get(
            f'/api/contacts/{contact.id}',
            **self._auth(),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['ai_insights']['needs'], 'CRM для продаж')
        self.assertEqual(response.data['ai_insights']['probability'], 70)
        self.assertIn('last_ai_deal_created_at', response.data)

    def test_ai_insights_endpoint_returns_normalized_payload(self):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='AI Контакт',
            ai_insights={
                'needs': 'CRM для продаж',
                'confidence': 0.8,
            },
        )

        response = self.client.get(
            f'/api/contacts/{contact.id}/ai-insights',
            **self._auth(),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['contact_id'], str(contact.id))
        self.assertEqual(response.data['ai_insights']['needs'], 'CRM для продаж')
        self.assertEqual(response.data['ai_insights']['confidence'], 0.8)
        self.assertIsNone(response.data['ai_insights']['budget'])
        self.assertIn('last_analyzed_at', response.data['ai_insights'])

    def test_ai_insights_endpoint_hides_foreign_contact(self):
        other = User.objects.create_user(
            email='foreign-contact@example.com',
            password='StrongPass1',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        contact = Contact.objects.create(
            workspace=other.workspace,
            name='Чужой контакт',
            ai_insights={'needs': 'Не показывать'},
        )

        response = self.client.get(
            f'/api/contacts/{contact.id}/ai-insights',
            **self._auth(),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_patch_uses_optimistic_lock_and_skips_noop(self):
        contact_id = self._create().data['id']
        no_change = self.client.patch(
            f'/api/contacts/{contact_id}',
            {'name': 'Иван Петров', 'version': 1},
            format='json',
            **self._auth(),
        )
        changed = self.client.patch(
            f'/api/contacts/{contact_id}',
            {'company': 'ООО Ромашка', 'version': 1},
            format='json',
            **self._auth(),
        )
        conflict = self.client.patch(
            f'/api/contacts/{contact_id}',
            {'email': 'new@example.com', 'version': 1},
            format='json',
            **self._auth(),
        )

        self.assertEqual(no_change.status_code, status.HTTP_200_OK)
        self.assertEqual(no_change.data['version'], 1)
        self.assertEqual(changed.status_code, status.HTTP_200_OK)
        self.assertEqual(changed.data['version'], 2)
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(conflict.data['error'], 'version_conflict')
        self.assertEqual(conflict.data['current_version'], 2)
        self.assertEqual(
            ContactAuditLog.objects.filter(
                action=ContactAuditAction.UPDATED,
            ).count(),
            1,
        )

    def test_delete_is_soft_and_second_request_is_404(self):
        contact_id = self._create().data['id']

        first = self.client.delete(
            f'/api/contacts/{contact_id}',
            **self._auth(),
        )
        second = self.client.delete(
            f'/api/contacts/{contact_id}',
            **self._auth(),
        )

        self.assertEqual(first.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(second.status_code, status.HTTP_404_NOT_FOUND)
        contact = Contact.objects.get(id=contact_id)
        self.assertTrue(contact.is_deleted)
        self.assertIsNotNone(contact.deleted_at)

    def test_bulk_delete_deduplicates_and_reports_skipped_ids(self):
        active = Contact.objects.create(
            workspace=self.user.workspace,
            name='Активный',
        )
        deleted = Contact.objects.create(
            workspace=self.user.workspace,
            name='Удалённый',
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        missing = uuid.uuid4()

        response = self.client.delete(
            self.bulk_url,
            {
                'contact_ids': [
                    str(active.id),
                    str(active.id),
                    str(deleted.id),
                    str(missing),
                ],
            },
            format='json',
            **self._auth(),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['deleted_count'], 1)
        self.assertEqual(
            {item['reason'] for item in response.data['skipped_ids']},
            {'already_deleted', 'not_found'},
        )

    def test_bulk_delete_rejects_more_than_100_unique_ids(self):
        response = self.client.delete(
            self.bulk_url,
            {'contact_ids': [str(uuid.uuid4()) for _ in range(101)]},
            format='json',
            **self._auth(),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_search_and_exact_find_are_workspace_scoped(self):
        expected = Contact.objects.create(
            workspace=self.user.workspace,
            name='Иван Петров',
            company='ООО Ромашка',
        )
        Contact.objects.create(
            workspace=self.user.workspace,
            name='Иван Удалённый',
            is_deleted=True,
            deleted_at=timezone.now(),
        )

        search = self.client.get(
            self.search_url,
            {'query': 'иван', 'limit': 5},
            **self._auth(),
        )
        exact = self.client.get(
            self.find_url,
            {'name': '  ИВАН ПЕТРОВ '},
            **self._auth(),
        )

        self.assertEqual(search.status_code, status.HTTP_200_OK)
        self.assertEqual(len(search.data), 1)
        self.assertEqual(search.data[0]['id'], str(expected.id))
        self.assertEqual(exact.status_code, status.HTTP_200_OK)
        self.assertEqual(exact.data['id'], str(expected.id))

    def test_contacts_require_authentication(self):
        response = APIClient().get(self.list_url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
