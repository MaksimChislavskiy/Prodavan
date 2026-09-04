import math
from time import perf_counter

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import Contact


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class NewTzSection9ContactCardTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='section9@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Иван Петров',
            company='ООО Ромашка',
            phone='+79991234567',
            email='old@example.com',
            telegram='@ivan_petrov',
            comment='Исходный комментарий',
        )

    def test_contact_detail_application_p95_is_within_300ms(self):
        warmup = self.client.get(f'/api/contacts/{self.contact.id}')
        self.assertEqual(warmup.status_code, status.HTTP_200_OK)

        samples = []
        for _ in range(30):
            started = perf_counter()
            response = self.client.get(f'/api/contacts/{self.contact.id}')
            samples.append(perf_counter() - started)
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        ordered = sorted(samples)
        p95 = ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]
        self.assertLessEqual(
            p95,
            0.3,
            f'GET /api/contacts/{{id}} application p95 is {p95:.3f}s',
        )

    def test_partial_patch_changes_only_submitted_fields_and_increments_version(self):
        initial_version = self.contact.version

        response = self.client.patch(
            f'/api/contacts/{self.contact.id}',
            {
                'version': initial_version,
                'email': 'new@example.com',
                'comment': None,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.contact.refresh_from_db()
        self.assertEqual(self.contact.version, initial_version + 1)
        self.assertEqual(self.contact.email, 'new@example.com')
        self.assertIsNone(self.contact.comment)
        self.assertEqual(self.contact.name, 'Иван Петров')
        self.assertEqual(self.contact.company, 'ООО Ромашка')
        self.assertEqual(self.contact.phone, '+79991234567')
        self.assertEqual(self.contact.telegram, '@ivan_petrov')
        self.assertEqual(response.data['version'], initial_version + 1)

    def test_stale_version_returns_409_with_current_version(self):
        current_version = self.contact.version
        self.contact.company = 'ООО Новая версия'
        self.contact.version += 1
        self.contact.save(update_fields=('company', 'version', 'updated_at'))

        response = self.client.patch(
            f'/api/contacts/{self.contact.id}',
            {
                'version': current_version,
                'email': 'stale@example.com',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['error'], 'version_conflict')
        self.assertEqual(response.data['current_version'], current_version + 1)
        self.contact.refresh_from_db()
        self.assertEqual(self.contact.email, 'old@example.com')

    def test_foreign_and_soft_deleted_contacts_are_404(self):
        other = User.objects.create_user(
            email='section9-other@example.com',
            password='StrongPass1',
            first_name='Олег',
            last_name='Другой',
            is_confirmed=True,
        )
        foreign = Contact.objects.create(
            workspace=other.workspace,
            name='Чужой контакт',
        )

        foreign_response = self.client.get(f'/api/contacts/{foreign.id}')
        self.assertEqual(foreign_response.status_code, status.HTTP_404_NOT_FOUND)

        self.contact.is_deleted = True
        self.contact.save(update_fields=('is_deleted', 'updated_at'))
        deleted_response = self.client.get(f'/api/contacts/{self.contact.id}')
        self.assertEqual(deleted_response.status_code, status.HTTP_404_NOT_FOUND)
