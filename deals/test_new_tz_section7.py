import math
from time import perf_counter
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from users.models import User

from .models import Deal, DealEvent, DealHistory, SalesStage


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class NewTzSection7RegressionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='section7@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
            is_deleted=False,
        )
        self.contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Иван Петров',
            company='ООО Ромашка',
            phone='+79991234567',
            email='ivan@example.com',
            telegram='@ivan123',
        )
        self.deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=self.stage,
            contact=self.contact,
            name='Карточка сделки',
            amount='150000.00',
            comment='Исходный комментарий',
        )

    def test_detail_application_p95_is_within_300ms(self):
        url = f'/api/crm/deals/{self.deal.id}'
        warmup = self.client.get(url)
        self.assertEqual(warmup.status_code, status.HTTP_200_OK)

        samples = []
        for _ in range(20):
            started = perf_counter()
            response = self.client.get(url)
            samples.append(perf_counter() - started)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.data['contact']['id'], str(self.contact.id))

        ordered = sorted(samples)
        p95 = ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]
        self.assertLessEqual(
            p95,
            0.3,
            f'GET /api/crm/deals/{{id}} application p95 is {p95:.3f}s',
        )

    def test_patch_returns_full_detail_and_requires_contact_for_manual_save(self):
        response = self.client.patch(
            f'/api/crm/deals/{self.deal.id}',
            {
                'version': self.deal.version,
                'name': 'Обновлённая карточка',
                'amount': '200000.00',
                'comment': 'Новый комментарий',
                'contact_id': str(self.contact.id),
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Обновлённая карточка')
        self.assertEqual(response.data['comment'], 'Новый комментарий')
        self.assertEqual(response.data['contact']['name'], self.contact.name)
        self.assertEqual(response.data['version'], 2)
        self.assertIn('stage_id', response.data)
        self.assertIn('created_at', response.data)
        self.assertIn('updated_at', response.data)

        detached = Deal.objects.create(
            workspace=self.user.workspace,
            stage=self.stage,
            contact=None,
            name='Сделка после удаления контакта',
        )
        rejected = self.client.patch(
            f'/api/crm/deals/{detached.id}',
            {
                'version': detached.version,
                'name': 'Нельзя сохранить без контакта',
            },
            format='json',
        )
        self.assertEqual(rejected.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            rejected.data['error']['message'],
            'Для сохранения сделки необходимо выбрать контакт.',
        )

    def test_noop_patch_does_not_increment_or_emit_history_or_websocket(self):
        url = f'/api/crm/deals/{self.deal.id}'
        with patch('deals.services.broadcast_workspace_event') as broadcast:
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.patch(
                    url,
                    {
                        'version': self.deal.version,
                        'name': self.deal.name,
                        'amount': '150000.00',
                        'comment': self.deal.comment,
                        'contact_id': str(self.contact.id),
                    },
                    format='json',
                )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['version'], 1)
        self.assertFalse(
            DealHistory.objects.filter(
                deal=self.deal,
                event_type=DealEvent.UPDATED,
            ).exists(),
        )
        broadcast.assert_not_called()

    def test_foreign_workspace_detail_and_patch_are_hidden(self):
        other = User.objects.create_user(
            email='section7-other@example.com',
            password='StrongPass1',
            first_name='Анна',
            last_name='Иванова',
            is_confirmed=True,
        )
        self.client.force_authenticate(other)
        url = f'/api/crm/deals/{self.deal.id}'

        detail = self.client.get(url)
        patched = self.client.patch(
            url,
            {'version': self.deal.version, 'name': 'Чужая правка'},
            format='json',
        )

        self.assertEqual(detail.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(patched.status_code, status.HTTP_404_NOT_FOUND)
