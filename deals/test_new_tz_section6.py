import math
from time import perf_counter
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import Deal, DealHistory, SalesStage


TEST_CHANNEL_LAYERS = {
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
}


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
)
class NewTzSection6RegressionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='section6-nfr@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.system_stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
            is_deleted=False,
        )

    def test_kanban_application_p95_with_10000_deals_is_within_one_second(self):
        stages = [self.system_stage]
        for index in range(2, 21):
            stages.append(
                SalesStage.objects.create(
                    workspace=self.user.workspace,
                    name=f'Этап {index:02d}',
                    order=index,
                ),
            )

        Deal.objects.bulk_create(
            [
                Deal(
                    workspace=self.user.workspace,
                    stage=stage,
                    name=f'Сделка {stage.order:02d}-{index:04d}',
                )
                for stage in stages
                for index in range(500)
            ],
            batch_size=1000,
        )
        self.assertEqual(Deal.objects.count(), 10_000)

        warmup = self.client.get('/api/crm/kanban')
        self.assertEqual(warmup.status_code, status.HTTP_200_OK)
        self.assertEqual(len(warmup.data['stages']), 20)
        self.assertTrue(
            all(len(warmup.data['deals'][str(stage.id)]) == 20 for stage in stages),
        )
        self.assertTrue(
            all(stage_data['deal_count'] == 500 for stage_data in warmup.data['stages']),
        )

        samples = []
        for _ in range(20):
            started = perf_counter()
            response = self.client.get('/api/crm/kanban')
            samples.append(perf_counter() - started)
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        ordered = sorted(samples)
        p95 = ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]
        self.assertLessEqual(
            p95,
            1.0,
            f'GET /api/crm/kanban application p95 is {p95:.3f}s',
        )

    def test_move_deal_application_p95_is_within_300ms(self):
        second_stage = SalesStage.objects.create(
            workspace=self.user.workspace,
            name='В работе',
            order=2,
        )
        deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=self.system_stage,
            name='Сделка для benchmark перемещения',
        )

        samples = []
        current_stage = self.system_stage
        current_version = deal.version
        for _ in range(20):
            target_stage = (
                second_stage if current_stage.id == self.system_stage.id else self.system_stage
            )
            started = perf_counter()
            response = self.client.patch(
                f'/api/crm/deals/{deal.id}/stage',
                {
                    'stage_id': str(target_stage.id),
                    'version': current_version,
                },
                format='json',
            )
            samples.append(perf_counter() - started)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            current_version = response.data['version']
            current_stage = target_stage

        ordered = sorted(samples)
        p95 = ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]
        self.assertLessEqual(
            p95,
            0.3,
            f'PATCH deal stage application p95 is {p95:.3f}s',
        )

    def test_stage_delete_uses_batch_event_and_one_correlation_id_for_50_deals(self):
        stage = SalesStage.objects.create(
            workspace=self.user.workspace,
            name='Массовый этап',
            order=2,
        )
        Deal.objects.bulk_create(
            [
                Deal(
                    workspace=self.user.workspace,
                    stage=stage,
                    name=f'Массовая сделка {index:02d}',
                )
                for index in range(50)
            ],
        )

        emitted = []
        with patch(
            'deals.services.broadcast_workspace_event',
            side_effect=lambda workspace_id, payload: emitted.append((workspace_id, payload)),
        ):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.delete(
                    f'/api/crm/stages/{stage.id}',
                    {'version': stage.version},
                    format='json',
                )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(
            SalesStage.objects.filter(id=stage.id, is_deleted=False).exists(),
        )
        self.assertEqual(
            Deal.objects.filter(stage=self.system_stage, is_deleted=False).count(),
            50,
        )
        histories = DealHistory.objects.filter(reason='stage_deleted')
        self.assertEqual(histories.count(), 50)
        self.assertEqual(set(histories.values_list('changed_by_type', flat=True)), {'system'})

        payloads = [payload for _, payload in emitted]
        batch = [payload for payload in payloads if payload.get('event') == 'deals_stage_changed_batch']
        deleted = [payload for payload in payloads if payload.get('event') == 'stage_deleted']
        self.assertEqual(len(batch), 1)
        self.assertEqual(len(deleted), 1)
        self.assertEqual(batch[0]['data']['count'], 50)
        self.assertEqual(batch[0]['data']['from_stage_id'], str(stage.id))
        self.assertEqual(batch[0]['data']['to_stage_id'], str(self.system_stage.id))
        self.assertTrue(batch[0].get('correlation_id'))
        self.assertEqual(batch[0]['correlation_id'], deleted[0]['correlation_id'])
