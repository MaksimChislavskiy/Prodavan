import uuid

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from users.models import User

from .models import ChangedByType, Deal, DealEvent, DealHistory, SalesStage


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class DealApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='crm@example.com',
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
        self.auth = {'HTTP_AUTHORIZATION': f"Bearer {response.data['access_token']}"}
        self.stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
        )
        self.contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Иван Петров',
            company='ООО Ромашка',
            phone='+79991234567',
        )

    def create_deal(self, **overrides):
        payload = {
            'name': 'Первая сделка',
            'amount': '150000.00',
            'contact_id': str(self.contact.id),
            'comment': 'Важно',
        }
        payload.update(overrides)
        return self.client.post(
            '/api/crm/deals',
            payload,
            format='json',
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
            **self.auth,
        )

    def test_workspace_gets_protected_system_stage(self):
        self.assertEqual(self.stage.name, 'Новый лид')
        self.assertEqual(self.stage.order, 1)
        self.assertEqual(self.stage.version, 1)

        response = self.client.patch(
            f'/api/crm/stages/{self.stage.id}',
            {'name': 'Другое', 'version': self.stage.version},
            format='json',
            **self.auth,
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_creation_requires_and_replays_idempotency_key(self):
        payload = {'name': 'Сделка', 'contact_id': str(self.contact.id)}
        missing = self.client.post('/api/crm/deals', payload, format='json', **self.auth)
        self.assertEqual(missing.status_code, status.HTTP_400_BAD_REQUEST)

        key = str(uuid.uuid4())
        first = self.client.post(
            '/api/crm/deals', payload, format='json',
            HTTP_IDEMPOTENCY_KEY=key, **self.auth,
        )
        replay = self.client.post(
            '/api/crm/deals', payload, format='json',
            HTTP_IDEMPOTENCY_KEY=key, **self.auth,
        )
        conflict = self.client.post(
            '/api/crm/deals', {'name': 'Другая'}, format='json',
            HTTP_IDEMPOTENCY_KEY=key, **self.auth,
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        self.assertEqual(replay.data['id'], first.data['id'])
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(Deal.objects.count(), 1)
        self.assertNotIn('comment', first.data)

    def test_create_validates_fields_and_contact_workspace(self):
        bad_amount = self.create_deal(amount='100.001')
        self.assertEqual(bad_amount.status_code, status.HTTP_400_BAD_REQUEST)

        other = User.objects.create_user(
            email='other@example.com',
            password='StrongPass1',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        foreign_contact = Contact.objects.create(
            workspace=other.workspace,
            name='Чужой Контакт',
        )
        foreign = self.create_deal(contact_id=str(foreign_contact.id))
        self.assertEqual(foreign.status_code, status.HTTP_400_BAD_REQUEST)

    def test_kanban_limits_each_stage_and_omits_comment(self):
        Deal.objects.bulk_create([
            Deal(
                workspace=self.user.workspace,
                stage=self.stage,
                contact=self.contact,
                name=f'Сделка {index}',
                comment='Скрыто',
            )
            for index in range(21)
        ])
        response = self.client.get('/api/crm/kanban', **self.auth)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['stages'][0]['deal_count'], 21)
        rows = response.data['deals'][str(self.stage.id)]
        self.assertEqual(len(rows), 20)
        self.assertNotIn('comment', rows[0])

    def test_deal_pagination_uses_opaque_cursor(self):
        for index in range(3):
            Deal.objects.create(
                workspace=self.user.workspace,
                stage=self.stage,
                name=f'Сделка {index}',
            )
        first = self.client.get(
            '/api/crm/deals',
            {'stage_id': self.stage.id, 'limit': 2},
            **self.auth,
        )
        second = self.client.get(
            '/api/crm/deals',
            {'stage_id': self.stage.id, 'limit': 2, 'cursor': first.data['next_cursor']},
            **self.auth,
        )
        self.assertTrue(first.data['has_more'])
        self.assertEqual(len(second.data['deals']), 1)
        self.assertFalse(second.data['has_more'])

    def test_update_is_versioned_and_noop_does_not_increment(self):
        created = self.create_deal()
        deal_id = created.data['id']
        detail = self.client.get(f'/api/crm/deals/{deal_id}', **self.auth)

        unchanged = self.client.patch(
            f'/api/crm/deals/{deal_id}',
            {'name': detail.data['name'], 'version': detail.data['version']},
            format='json',
            **self.auth,
        )
        changed = self.client.patch(
            f'/api/crm/deals/{deal_id}',
            {'name': 'Обновлённая', 'version': detail.data['version']},
            format='json',
            **self.auth,
        )
        stale = self.client.patch(
            f'/api/crm/deals/{deal_id}',
            {'name': 'Устаревшая', 'version': detail.data['version']},
            format='json',
            **self.auth,
        )

        self.assertEqual(unchanged.data['version'], detail.data['version'])
        self.assertEqual(changed.data['version'], detail.data['version'] + 1)
        self.assertEqual(stale.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(stale.data['error']['current_version'], changed.data['version'])

    def test_detail_includes_ai_insights(self):
        deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=self.stage,
            contact=self.contact,
            name='AI Сделка',
            ai_insights={
                'needs': 'Автоматизация продаж',
                'budget': '250000 RUB',
                'timeline': 'Q3',
                'objections': ['Нужна интеграция'],
                'next_step': 'Назначить демо',
                'probability': 82,
                'last_analyzed_at': '2026-07-09T12:00:00+00:00',
                'confidence': 0.91,
            },
        )

        response = self.client.get(f'/api/crm/deals/{deal.id}', **self.auth)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data['ai_insights']['needs'],
            'Автоматизация продаж',
        )
        self.assertEqual(response.data['ai_insights']['probability'], 82)

    def test_move_is_versioned_and_same_stage_is_noop(self):
        target = self.client.post(
            '/api/crm/stages', {'name': 'В работе'}, format='json', **self.auth,
        ).data
        created = self.create_deal()
        deal = Deal.objects.get(id=created.data['id'])

        moved = self.client.patch(
            f'/api/crm/deals/{deal.id}/stage',
            {'stage_id': target['id'], 'version': deal.version},
            format='json',
            **self.auth,
        )
        same = self.client.patch(
            f'/api/crm/deals/{deal.id}/stage',
            {'stage_id': target['id'], 'version': moved.data['version']},
            format='json',
            **self.auth,
        )

        self.assertEqual(moved.status_code, status.HTTP_200_OK)
        self.assertEqual(same.data['version'], moved.data['version'])
        self.assertEqual(
            DealHistory.objects.filter(
                deal_id=deal.id,
                event_type=DealEvent.STAGE_CHANGED,
            ).count(),
            1,
        )

    def test_soft_delete_is_idempotent_and_history_remains_available(self):
        created = self.create_deal()
        url = f"/api/crm/deals/{created.data['id']}"
        first = self.client.delete(url, **self.auth)
        second = self.client.delete(url, **self.auth)
        detail = self.client.get(url, **self.auth)
        history = self.client.get(f'{url}/history', **self.auth)

        self.assertEqual(first.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(second.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(detail.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(history.status_code, status.HTTP_200_OK)
        self.assertEqual(history.data['history'][0]['event_type'], DealEvent.DELETED)

    def test_deleting_stage_moves_deals_and_records_system_reason(self):
        stage = self.client.post(
            '/api/crm/stages', {'name': 'Квалификация'}, format='json', **self.auth,
        ).data
        created = self.create_deal()
        moved = self.client.patch(
            f"/api/crm/deals/{created.data['id']}/stage",
            {'stage_id': stage['id'], 'version': created.data['version']},
            format='json',
            **self.auth,
        )
        deleted = self.client.delete(
            f"/api/crm/stages/{stage['id']}",
            {'version': stage['version']},
            format='json',
            **self.auth,
        )
        deal = Deal.objects.get(id=created.data['id'])
        history = DealHistory.objects.filter(
            deal=deal,
            reason='stage_deleted',
        ).get()

        self.assertEqual(moved.status_code, status.HTTP_200_OK)
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(deal.stage_id, self.stage.id)
        self.assertEqual(history.changed_by_type, ChangedByType.SYSTEM)

    def test_workspace_isolation_returns_not_found(self):
        created = self.create_deal()
        other = User.objects.create_user(
            email='isolated@example.com',
            password='StrongPass1',
            first_name='Анна',
            last_name='Иванова',
            is_confirmed=True,
        )
        self.client.force_authenticate(other)
        response = self.client.get(f"/api/crm/deals/{created.data['id']}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unauthorized_requests_are_rejected(self):
        response = APIClient().get('/api/crm/kanban')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
