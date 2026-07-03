import uuid
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from contacts.models import Contact
from deals.models import Deal, SalesStage
from users.models import User

from .models import Task, TaskAuditLog, TaskEvent, TaskHistory, TaskSource, TaskStatus
from .services import create_task


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class TaskApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='tasks@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        self.user.workspace.timezone = 'Europe/Moscow'
        self.user.workspace.save(update_fields=('timezone', 'updated_at'))
        self.client.force_authenticate(self.user)
        self.contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Иван Петров',
        )
        self.stage = SalesStage.objects.get(
            workspace=self.user.workspace,
            is_system=True,
        )
        self.deal = Deal.objects.create(
            workspace=self.user.workspace,
            stage=self.stage,
            contact=self.contact,
            name='Продажа лицензии',
            amount='100000.00',
        )

    def create_task(self, **overrides):
        payload = {
            'title': 'Позвонить клиенту',
            'contact_id': str(self.contact.id),
            'deal_id': str(self.deal.id),
        }
        payload.update(overrides)
        return self.client.post(
            '/api/tasks',
            payload,
            format='json',
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )

    def test_create_requires_key_and_is_idempotent(self):
        payload = {'title': 'Подготовить договор'}
        missing = self.client.post('/api/tasks', payload, format='json')
        key = str(uuid.uuid4())
        first = self.client.post(
            '/api/tasks', payload, format='json', HTTP_IDEMPOTENCY_KEY=key,
        )
        replay = self.client.post(
            '/api/tasks', payload, format='json', HTTP_IDEMPOTENCY_KEY=key,
        )
        conflict = self.client.post(
            '/api/tasks', {'title': 'Другая'}, format='json',
            HTTP_IDEMPOTENCY_KEY=key,
        )

        self.assertEqual(missing.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        self.assertEqual(replay.data['id'], first.data['id'])
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(conflict.data['error'], 'idempotency_key_reused')
        self.assertEqual(Task.objects.count(), 1)

    def test_create_validates_due_date_and_relations(self):
        missing_date = self.create_task(due_date_type='date')
        date_without_type = self.create_task(due_date='2026-06-20')

        other_contact = Contact.objects.create(
            workspace=self.user.workspace,
            name='Другой Контакт',
        )
        mismatch = self.create_task(contact_id=str(other_contact.id))

        self.assertEqual(missing_date.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(date_without_type.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(mismatch.status_code, status.HTTP_400_BAD_REQUEST)

    def test_date_only_is_normalized_in_workspace_timezone(self):
        response = self.create_task(
            due_date_type='date',
            due_date='2026-06-20',
        )
        task = Task.objects.get(id=response.data['id'])

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        local = task.due_date.astimezone(ZoneInfo('Europe/Moscow'))
        self.assertEqual(local.date().isoformat(), '2026-06-20')
        self.assertEqual((local.hour, local.minute), (0, 0))

    def test_kanban_returns_three_columns_counts_and_nulls_last(self):
        dated = Task.objects.create(
            workspace=self.user.workspace,
            title='Со сроком',
            due_date=timezone.now(),
            due_date_type='datetime',
        )
        Task.objects.create(workspace=self.user.workspace, title='Без срока')
        Task.objects.create(
            workspace=self.user.workspace,
            title='Выполненная',
            status=TaskStatus.DONE,
        )

        response = self.client.get('/api/tasks/kanban', {'limit': 1})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(set(response.data), set(TaskStatus.values))
        self.assertEqual(response.data['new']['count'], 2)
        self.assertEqual(response.data['new']['tasks'][0]['id'], str(dated.id))
        self.assertIsNotNone(response.data['new']['next_cursor'])

    def test_column_cursor_pagination_is_stable(self):
        for index in range(3):
            Task.objects.create(
                workspace=self.user.workspace,
                title=f'Задача {index}',
                due_date=timezone.now() + timedelta(days=index),
                due_date_type='datetime',
            )
        first = self.client.get('/api/tasks', {'status': 'new', 'limit': 2})
        second = self.client.get('/api/tasks', {
            'status': 'new',
            'limit': 2,
            'cursor': first.data['next_cursor'],
        })

        self.assertTrue(first.data['has_more'])
        self.assertEqual(len(second.data['tasks']), 1)
        self.assertFalse(second.data['has_more'])

    def test_dashboard_filters_done_and_future_tasks(self):
        now = timezone.now()
        overdue = Task.objects.create(
            workspace=self.user.workspace,
            title='Просроченная',
            due_date=now - timedelta(days=2),
            due_date_type='datetime',
        )
        no_due = Task.objects.create(
            workspace=self.user.workspace,
            title='Без срока',
        )
        Task.objects.create(
            workspace=self.user.workspace,
            title='Завтра',
            due_date=now + timedelta(days=2),
            due_date_type='datetime',
        )
        Task.objects.create(
            workspace=self.user.workspace,
            title='Выполнена',
            status=TaskStatus.DONE,
        )

        response = self.client.get('/api/tasks/dashboard')

        self.assertEqual(response.data['total_count'], 2)
        self.assertEqual(response.data['tasks'][0]['id'], str(overdue.id))
        self.assertTrue(response.data['tasks'][0]['is_overdue'])
        self.assertEqual(response.data['tasks'][1]['id'], str(no_due.id))

    def test_update_is_versioned_noop_and_status_is_forbidden(self):
        created = self.create_task()
        task_id = created.data['id']
        version = created.data['version']
        unchanged = self.client.patch(
            f'/api/tasks/{task_id}',
            {'title': created.data['title'], 'version': version},
            format='json',
        )
        changed = self.client.patch(
            f'/api/tasks/{task_id}',
            {'title': 'Новое название', 'version': version},
            format='json',
        )
        stale = self.client.patch(
            f'/api/tasks/{task_id}',
            {'title': 'Устаревшее', 'version': version},
            format='json',
        )
        forbidden = self.client.patch(
            f'/api/tasks/{task_id}',
            {'status': 'done', 'version': changed.data['version']},
            format='json',
        )

        self.assertEqual(unchanged.data['version'], version)
        self.assertEqual(changed.data['version'], version + 1)
        self.assertEqual(stale.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(stale.data['current_version'], version + 1)
        self.assertEqual(forbidden.status_code, status.HTTP_400_BAD_REQUEST)

    def test_status_update_is_versioned_and_idempotent(self):
        created = self.create_task()
        url = f"/api/tasks/{created.data['id']}/status"
        moved = self.client.patch(
            url,
            {'status': 'in_progress', 'version': created.data['version']},
            format='json',
        )
        same = self.client.patch(
            url,
            {'status': 'in_progress', 'version': moved.data['version']},
            format='json',
        )

        self.assertEqual(moved.data['version'], created.data['version'] + 1)
        self.assertEqual(same.data['version'], moved.data['version'])
        self.assertEqual(
            TaskHistory.objects.filter(
                task_id=created.data['id'],
                changes__has_key='status',
            ).count(),
            1,
        )

    def test_single_delete_repeats_as_404_and_history_remains(self):
        created = self.create_task()
        url = f"/api/tasks/{created.data['id']}"
        first = self.client.delete(url)
        second = self.client.delete(url)
        detail = self.client.get(url)
        history = self.client.get(f'{url}/history')

        self.assertEqual(first.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(second.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(detail.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(history.status_code, status.HTTP_200_OK)
        self.assertEqual(history.data['items'][0]['event'], TaskEvent.DELETED)

    def test_bulk_delete_deduplicates_and_reports_skips(self):
        first = Task.objects.create(workspace=self.user.workspace, title='Первая')
        second = Task.objects.create(
            workspace=self.user.workspace,
            title='Удалённая',
            is_deleted=True,
            deleted_at=timezone.now(),
        )
        missing = uuid.uuid4()
        response = self.client.post('/api/tasks/bulk-delete', {
            'task_ids': [str(first.id), str(first.id), str(second.id), str(missing)],
        }, format='json')

        self.assertEqual(response.data['deleted_count'], 1)
        reasons = {item['reason'] for item in response.data['skipped_ids']}
        self.assertEqual(reasons, {'already_deleted', 'not_found'})
        audit = TaskAuditLog.objects.filter(event=TaskEvent.BULK_DELETED).get()
        self.assertEqual(audit.details['deleted_count'], 1)

    def test_contact_and_deal_deletion_detach_task_with_system_history(self):
        created = self.create_task()
        task_id = created.data['id']
        contact_response = self.client.delete(f'/api/contacts/{self.contact.id}')
        after_contact = Task.objects.get(id=task_id)
        deal_response = self.client.delete(f'/api/crm/deals/{self.deal.id}')
        after_deal = Task.objects.get(id=task_id)

        self.assertEqual(contact_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIsNone(after_contact.contact_id)
        self.assertEqual(deal_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIsNone(after_deal.deal_id)
        system_entries = TaskHistory.objects.filter(
            task_id=task_id,
            source=TaskSource.SYSTEM,
        )
        self.assertEqual(system_entries.count(), 2)

    def test_ai_service_marks_creator_and_source(self):
        body, response_status = create_task(
            workspace=self.user.workspace,
            user=None,
            data={'title': 'AI задача', 'due_date_type': 'none'},
            idempotency_key=str(uuid.uuid4()),
            source=TaskSource.AI,
        )
        task = Task.objects.get(id=body['id'])
        history = task.history.get(event=TaskEvent.CREATED)

        self.assertEqual(response_status, status.HTTP_201_CREATED)
        self.assertTrue(task.created_by_ai)
        self.assertIsNone(task.created_by_user_id)
        self.assertEqual(history.source, TaskSource.AI)

    def test_other_workspace_is_hidden(self):
        created = self.create_task()
        other = User.objects.create_user(
            email='other-tasks@example.com',
            password='StrongPass1',
            first_name='Анна',
            last_name='Петрова',
            is_confirmed=True,
        )
        self.client.force_authenticate(other)
        response = self.client.get(f"/api/tasks/{created.data['id']}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unauthorized_request_is_rejected(self):
        response = APIClient().get('/api/tasks/kanban')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
