import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from django.db import connection, connections
from django.test import TransactionTestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import Deal, DealEvent, DealHistory, DealIdempotencyRecord, SalesStage


TEST_CHANNEL_LAYERS = {
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
}


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
)
class DealIdempotencyConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.user = User.objects.create_user(
            email='deal-race@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.system_stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
        )

    def tearDown(self):
        # ThreadPoolExecutor создаёт отдельные Django/PostgreSQL connections.
        # В локальном окружении CONN_MAX_AGE > 0, поэтому psycopg может оставить
        # backend-session живой после завершения worker thread. Перед штатным
        # TransactionTestCase teardown закрываем такие тестовые сессии, иначе
        # PostgreSQL не даст удалить test_prodavan после полностью успешного прогона.
        self._terminate_stray_postgresql_sessions()
        connections.close_all()
        super().tearDown()

    def test_concurrent_create_with_same_key_returns_same_deal(self):
        key = str(uuid.uuid4())
        payload = {'name': 'Одна конкурентная сделка'}
        barrier = threading.Barrier(2)

        def worker(_):
            barrier.wait(timeout=10)
            return self._create_deal_request(payload, key)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(worker, range(2)))

        statuses = sorted(result[0] for result in results)
        ids = {result[1]['id'] for result in results}

        self.assertEqual(statuses, [status.HTTP_200_OK, status.HTTP_201_CREATED])
        self.assertEqual(len(ids), 1)
        self.assertEqual(Deal.objects.filter(workspace=self.user.workspace).count(), 1)
        self.assertEqual(
            DealIdempotencyRecord.objects.filter(
                workspace=self.user.workspace,
                operation='create',
                key=key,
            ).count(),
            1,
        )
        self.assertEqual(
            DealHistory.objects.filter(
                workspace=self.user.workspace,
                event_type=DealEvent.CREATED,
            ).count(),
            1,
        )

    def test_concurrent_move_with_same_key_returns_same_result(self):
        deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=self.system_stage,
            name='Сделка для перемещения',
        )
        target_stage = SalesStage.objects.create(
            workspace=self.user.workspace,
            name='Переговоры',
            order=2,
        )
        key = str(uuid.uuid4())
        barrier = threading.Barrier(2)

        def worker(_):
            barrier.wait(timeout=10)
            return self._move_deal_request(
                deal.id,
                target_stage.id,
                deal.version,
                key,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(worker, range(2)))

        self.assertEqual(
            sorted(result[0] for result in results),
            [status.HTTP_200_OK, status.HTTP_200_OK],
            msg=results,
        )
        self.assertEqual({result[1]['id'] for result in results}, {str(deal.id)})
        self.assertEqual({result[1]['version'] for result in results}, {2})

        deal.refresh_from_db()
        self.assertEqual(deal.stage_id, target_stage.id)
        self.assertEqual(deal.version, 2)
        self.assertEqual(
            DealIdempotencyRecord.objects.filter(
                workspace=self.user.workspace,
                operation='move',
                key=key,
            ).count(),
            1,
        )
        self.assertEqual(
            DealHistory.objects.filter(
                deal=deal,
                event_type=DealEvent.STAGE_CHANGED,
            ).count(),
            1,
        )

    def _create_deal_request(self, payload, key):
        connections.close_all()
        try:
            user = User.objects.select_related('workspace').get(id=self.user.id)
            client = APIClient()
            client.force_authenticate(user=user)
            response = client.post(
                '/api/crm/deals',
                payload,
                format='json',
                HTTP_IDEMPOTENCY_KEY=key,
            )
            return response.status_code, dict(response.data)
        finally:
            self._close_worker_connection()

    def _move_deal_request(self, deal_id, stage_id, version, key):
        connections.close_all()
        try:
            user = User.objects.select_related('workspace').get(id=self.user.id)
            client = APIClient()
            client.force_authenticate(user=user)
            response = client.patch(
                f'/api/crm/deals/{deal_id}/stage',
                {
                    'stage_id': str(stage_id),
                    'version': version,
                },
                format='json',
                HTTP_IDEMPOTENCY_KEY=key,
            )
            return response.status_code, dict(response.data)
        finally:
            self._close_worker_connection()

    @staticmethod
    def _close_worker_connection():
        # Явно закрываем proxy текущего worker thread, а затем все инициализированные
        # aliases этого thread. Это надёжнее close_old_connections при CONN_MAX_AGE.
        connection.close()
        connections.close_all()

    @staticmethod
    def _terminate_stray_postgresql_sessions():
        if connection.vendor != 'postgresql':
            return

        with connection.cursor() as cursor:
            cursor.execute(
                '''
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                ''',
            )
