from django.test import TestCase, override_settings

from deals.models import Deal, SalesStage
from users.models import User

from .models import Contact
from .services import bulk_delete_contacts, delete_contact


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class ContactDealDetachTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='contacts-deals@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.workspace = self.user.workspace
        self.stage = SalesStage.objects.create(
            workspace=self.workspace,
            name='Новый лид',
            order=1,
            is_system=True,
        )

    def _deal_for(self, contact, name):
        return Deal.objects.create(
            workspace=self.workspace,
            stage=self.stage,
            contact=contact,
            name=name,
        )

    def test_single_delete_detaches_related_deals(self):
        contact = Contact.objects.create(
            workspace=self.workspace,
            name='Иван Петров',
        )
        deal = self._deal_for(contact, 'Первая сделка')

        delete_contact(
            workspace=self.workspace,
            user=self.user,
            contact_id=contact.id,
        )

        contact.refresh_from_db()
        deal.refresh_from_db()
        self.assertTrue(contact.is_deleted)
        self.assertIsNone(deal.contact_id)

    def test_bulk_delete_detaches_only_related_workspace_deals(self):
        first = Contact.objects.create(
            workspace=self.workspace,
            name='Анна Петрова',
        )
        second = Contact.objects.create(
            workspace=self.workspace,
            name='Борис Иванов',
        )
        untouched = Contact.objects.create(
            workspace=self.workspace,
            name='Вера Сидорова',
        )
        first_deal = self._deal_for(first, 'Сделка Анны')
        second_deal = self._deal_for(second, 'Сделка Бориса')
        untouched_deal = self._deal_for(untouched, 'Сделка Веры')

        result = bulk_delete_contacts(
            workspace=self.workspace,
            user=self.user,
            contact_ids=[first.id, second.id],
        )

        first_deal.refresh_from_db()
        second_deal.refresh_from_db()
        untouched_deal.refresh_from_db()
        self.assertEqual(result['deleted_count'], 2)
        self.assertIsNone(first_deal.contact_id)
        self.assertIsNone(second_deal.contact_id)
        self.assertEqual(untouched_deal.contact_id, untouched.id)
