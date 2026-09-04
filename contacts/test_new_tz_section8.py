import math
import uuid
from time import perf_counter

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from deals.models import Deal, SalesStage
from tasks.models import Task
from users.models import User

from .models import Contact, ContactAuditAction, ContactAuditLog


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class NewTzSection8RegressionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='section8@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_first_page_application_p95_is_within_one_second(self):
        Contact.objects.bulk_create(
            [
                Contact(
                    workspace=self.user.workspace,
                    name=f'Контакт {index:05d}',
                    name_search=f'контакт {index:05d}',
                )
                for index in range(5000)
            ],
            batch_size=1000,
        )

        warmup = self.client.get('/api/contacts?page=1&limit=20&sort=name:asc,id:asc')
        self.assertEqual(warmup.status_code, status.HTTP_200_OK)
        self.assertEqual(len(warmup.data['contacts']), 20)
        self.assertEqual(warmup.data['total'], 5000)

        samples = []
        for _ in range(20):
            started = perf_counter()
            response = self.client.get('/api/contacts?page=1&limit=20&sort=name:asc,id:asc')
            samples.append(perf_counter() - started)
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        ordered = sorted(samples)
        p95 = ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]
        self.assertLessEqual(
            p95,
            1.0,
            f'GET /api/contacts first-page application p95 is {p95:.3f}s',
        )

    def test_http_audit_preserves_uuid_ip_and_user_agent(self):
        correlation_id = uuid.UUID('88888888-8888-4888-8888-888888888888')
        response = self.client.post(
            '/api/contacts',
            {'name': 'Иван Петров', 'phone': '+79990001122'},
            format='json',
            HTTP_X_REQUEST_ID=str(correlation_id),
            HTTP_X_FORWARDED_FOR='203.0.113.45, 10.0.0.2',
            HTTP_USER_AGENT='ProdavanSection8Contract/1.0',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        audit = ContactAuditLog.objects.get(
            action=ContactAuditAction.CREATED,
            contact_identifier=response.data['id'],
        )
        self.assertEqual(audit.correlation_id, correlation_id)
        self.assertEqual(audit.ip_address, '203.0.113.45')
        self.assertEqual(audit.user_agent, 'ProdavanSection8Contract/1.0')
        self.assertEqual(audit.user_id, self.user.id)
        self.assertEqual(audit.workspace_id, self.user.workspace_id)
        self.assertEqual(audit.changes['source'], 'user')

    def test_single_delete_detaches_deal_and_task_and_repeat_is_404(self):
        contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Удаляемый контакт',
        )
        stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
            is_deleted=False,
        )
        deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=stage,
            name='Связанная сделка',
            contact=contact,
        )
        task = Task.objects.create(
            workspace=self.user.workspace,
            title='Связанная задача',
            contact=contact,
            deal=deal,
        )
        correlation_id = uuid.UUID('77777777-7777-4777-8777-777777777777')

        response = self.client.delete(
            f'/api/contacts/{contact.id}',
            HTTP_X_REQUEST_ID=str(correlation_id),
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        contact.refresh_from_db()
        deal.refresh_from_db()
        task.refresh_from_db()
        self.assertTrue(contact.is_deleted)
        self.assertIsNotNone(contact.deleted_at)
        self.assertIsNone(deal.contact_id)
        self.assertIsNone(task.contact_id)

        audit = ContactAuditLog.objects.get(
            action=ContactAuditAction.DELETED,
            contact_identifier=contact.id,
        )
        self.assertEqual(audit.correlation_id, correlation_id)

        repeated = self.client.delete(f'/api/contacts/{contact.id}')
        self.assertEqual(repeated.status_code, status.HTTP_404_NOT_FOUND)

    def test_bulk_delete_deduplicates_audits_and_detaches_links(self):
        contacts = [
            Contact.objects.create(
                workspace=self.user.workspace,
                name=f'Массовый контакт {index:02d}',
            )
            for index in range(12)
        ]
        already_deleted = Contact.objects.create(
            workspace=self.user.workspace,
            name='Уже удалённый',
            is_deleted=True,
        )
        missing_id = uuid.UUID('66666666-6666-4666-8666-666666666666')
        stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
            is_deleted=False,
        )
        linked_deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=stage,
            name='Сделка массового удаления',
            contact=contacts[0],
        )
        linked_task = Task.objects.create(
            workspace=self.user.workspace,
            title='Задача массового удаления',
            contact=contacts[1],
        )
        correlation_id = uuid.UUID('55555555-5555-4555-8555-555555555555')
        ids = [str(contact.id) for contact in contacts]

        response = self.client.delete(
            '/api/contacts/bulk',
            {
                'contact_ids': [
                    *ids,
                    ids[0],
                    str(already_deleted.id),
                    str(missing_id),
                ],
            },
            format='json',
            HTTP_X_REQUEST_ID=str(correlation_id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['deleted_count'], 12)
        self.assertEqual(
            response.data['skipped_ids'],
            [
                {'id': str(already_deleted.id), 'reason': 'already_deleted'},
                {'id': str(missing_id), 'reason': 'not_found'},
            ],
        )
        linked_deal.refresh_from_db()
        linked_task.refresh_from_db()
        self.assertIsNone(linked_deal.contact_id)
        self.assertIsNone(linked_task.contact_id)

        audit = ContactAuditLog.objects.get(action=ContactAuditAction.BULK_DELETED)
        self.assertEqual(audit.correlation_id, correlation_id)
        self.assertEqual(
            audit.changes,
            {
                'deleted_count': 12,
                'skipped_count': 2,
                'first_10_ids': ids[:10],
            },
        )

    def test_soft_deleted_contacts_are_hidden_from_reads_and_do_not_block_reuse(self):
        deleted = Contact.objects.create(
            workspace=self.user.workspace,
            name='Старый Иван',
            phone='+79991112233',
            email='reuse@example.com',
            is_deleted=True,
        )

        listing = self.client.get('/api/contacts?page=1&limit=20')
        search = self.client.get('/api/contacts/search?query=Старый&limit=5')
        exact = self.client.get('/api/contacts/find-by-name?name=Старый%20Иван')

        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertEqual(listing.data['contacts'], [])
        self.assertEqual(search.status_code, status.HTTP_200_OK)
        self.assertEqual(search.data, [])
        self.assertEqual(exact.status_code, status.HTTP_200_OK)
        self.assertIsNone(exact.data)

        created = self.client.post(
            '/api/contacts',
            {
                'name': 'Новый Иван',
                'phone': '+79991112233',
                'email': 'reuse@example.com',
            },
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(created.data['id'], str(deleted.id))
