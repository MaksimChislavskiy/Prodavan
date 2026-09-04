import uuid

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from users.models import User

from .models import SalesStage


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class DealContractViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='deal-contract@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        response = self.client.post(
            '/api/auth/login',
            {'email': self.user.email, 'password': 'StrongPass1'},
            format='json',
        )
        self.auth = {
            'HTTP_AUTHORIZATION': f"Bearer {response.data['access_token']}",
        }
        self.contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Иван Петров',
        )
        self.system_stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
        )

    def test_create_requires_uuid_idempotency_key(self):
        payload = {
            'name': 'Сделка',
            'contact_id': str(self.contact.id),
        }
        response = self.client.post(
            '/api/crm/deals',
            payload,
            format='json',
            HTTP_IDEMPOTENCY_KEY='deal-create-not-a-uuid',
            **self.auth,
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Idempotency-Key', response.data['errors'])

    def test_create_accepts_uuid_idempotency_key(self):
        response = self.client.post(
            '/api/crm/deals',
            {
                'name': 'Сделка',
                'contact_id': str(self.contact.id),
            },
            format='json',
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
            **self.auth,
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_move_rejects_non_uuid_optional_idempotency_key(self):
        created = self.client.post(
            '/api/crm/deals',
            {
                'name': 'Сделка',
                'contact_id': str(self.contact.id),
            },
            format='json',
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
            **self.auth,
        )
        stage = SalesStage.objects.create(
            workspace=self.user.workspace,
            name='В работе',
            order=2,
        )

        response = self.client.patch(
            f"/api/crm/deals/{created.data['id']}/stage",
            {
                'stage_id': str(stage.id),
                'version': created.data['version'],
            },
            format='json',
            HTTP_IDEMPOTENCY_KEY='deal-move-not-a-uuid',
            **self.auth,
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Idempotency-Key', response.data['errors'])
