import tempfile
import uuid
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from ai_assistant.models import KnowledgeDocument, KnowledgeDocumentStatus
from ai_assistant.processing import process_knowledge_document
from users.models import User, UserRole

from .models import (
    OnboardingAuditEvent,
    Workspace,
    WorkspaceOnboarding,
    WorkspaceOnboardingAuditLog,
)
from .onboarding import onboarding_knowledge_state_changed


class FakeEmbeddingClient:
    def create_embeddings(self, texts):
        return [[1.0, 0.0] for _ in texts]


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class OnboardingApiTests(TestCase):
    status_url = '/api/user/onboarding-status'
    materials_url = '/api/user/onboarding/materials-viewed'
    materials_correlation = uuid.UUID('66666666-6666-4666-8666-666666666666')
    second_materials_correlation = uuid.UUID('77777777-7777-4777-8777-777777777777')
    upload_correlation = uuid.UUID('88888888-8888-4888-8888-888888888888')

    def setUp(self):
        self.media_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.media_dir.cleanup)
        self.settings_override = override_settings(MEDIA_ROOT=self.media_dir.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)

        self.workspace = Workspace.objects.create(name='Компания')
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            workspace=self.workspace,
            role=UserRole.ADMIN,
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _document(self, **overrides):
        defaults = {
            'workspace': self.workspace,
            'uploaded_by': self.user,
            'uploaded_by_identifier': self.user.id,
            'original_name': 'База.txt',
            'file': f'knowledge_base/test/{uuid.uuid4()}.txt',
            'size_bytes': 10,
            'mime_type': 'text/plain',
            'sha256': 'a' * 64,
            'status': KnowledgeDocumentStatus.READY,
        }
        defaults.update(overrides)
        return KnowledgeDocument.objects.create(**defaults)

    def test_endpoints_require_authentication_and_admin_role(self):
        anonymous = APIClient().get(self.status_url)
        self.user.role = UserRole.USER
        self.user.save(update_fields=('role', 'updated_at'))
        forbidden = self.client.get(self.status_url)

        self.assertEqual(anonymous.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

    def test_initial_status_is_created_lazily(self):
        response = self.client.get(self.status_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data,
            {
                'version': 1,
                'status': 'not_started',
                'completed_at': None,
                'steps': {
                    'knowledge_base_completed': False,
                    'materials_viewed': False,
                },
            },
        )
        self.assertTrue(
            WorkspaceOnboarding.objects.filter(workspace=self.workspace).exists(),
        )

    def test_existing_ready_document_migrates_workspace_to_in_progress(self):
        self._document()

        response = self.client.get(self.status_url)

        self.assertEqual(response.data['status'], 'in_progress')
        self.assertTrue(response.data['steps']['knowledge_base_completed'])
        self.assertFalse(response.data['steps']['materials_viewed'])

    @patch('workspaces.onboarding.broadcast_workspace_event')
    def test_materials_viewed_is_idempotent_and_emits_one_event(self, broadcast):
        with self.captureOnCommitCallbacks(execute=True):
            first = self.client.post(
                self.materials_url,
                HTTP_X_REQUEST_ID=str(self.materials_correlation),
            )
        with self.captureOnCommitCallbacks(execute=True):
            second = self.client.post(
                self.materials_url,
                HTTP_X_REQUEST_ID=str(self.second_materials_correlation),
            )

        self.assertEqual(first.data['status'], 'in_progress')
        self.assertEqual(second.data, first.data)
        self.assertEqual(
            WorkspaceOnboardingAuditLog.objects.filter(
                event=OnboardingAuditEvent.MATERIALS_VIEWED,
            ).count(),
            1,
        )
        audit = WorkspaceOnboardingAuditLog.objects.get(
            event=OnboardingAuditEvent.MATERIALS_VIEWED,
        )
        self.assertEqual(audit.correlation_id, self.materials_correlation)
        broadcast.assert_called_once()

    @patch('workspaces.onboarding.broadcast_workspace_event')
    def test_both_steps_complete_onboarding_irreversibly(self, broadcast):
        document = self._document()

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.materials_url)

        self.assertEqual(response.data['status'], 'completed')
        self.assertIsNotNone(response.data['completed_at'])
        state = WorkspaceOnboarding.objects.get(workspace=self.workspace)
        self.assertTrue(state.completed)
        self.assertTrue(
            WorkspaceOnboardingAuditLog.objects.filter(
                event=OnboardingAuditEvent.COMPLETED,
            ).exists(),
        )

        document.is_deleted = True
        document.save(update_fields=('is_deleted', 'updated_at'))
        after_delete = self.client.get(self.status_url)

        self.assertEqual(after_delete.data['status'], 'completed')
        self.assertEqual(
            after_delete.data['steps'],
            {
                'knowledge_base_completed': True,
                'materials_viewed': True,
            },
        )
        broadcast.assert_called_once()

    @patch('workspaces.onboarding.broadcast_workspace_event')
    def test_first_ready_document_completes_materials_only_state(self, broadcast):
        self.client.post(self.materials_url)
        document = self._document()

        with self.captureOnCommitCallbacks(execute=True):
            onboarding_knowledge_state_changed(
                workspace_id=self.workspace.id,
                previous_has_ready=False,
                current_has_ready=True,
                user_id=self.user.id,
                trigger_document_id=document.id,
            )

        state = WorkspaceOnboarding.objects.get(workspace=self.workspace)
        self.assertTrue(state.completed)
        completed = WorkspaceOnboardingAuditLog.objects.get(
            event=OnboardingAuditEvent.COMPLETED,
        )
        self.assertEqual(
            completed.details['reason']['trigger_document_id'],
            str(document.id),
        )
        payload = broadcast.call_args.args[1]
        self.assertEqual(payload['event'], 'onboarding_status_updated')
        self.assertEqual(payload['data']['status'], 'completed')

    def test_ready_documents_are_scoped_to_current_workspace(self):
        other_workspace = Workspace.objects.create(name='Другая компания')
        other_user = User.objects.create_user(
            email='other@example.com',
            password='StrongPass1',
            first_name='Пётр',
            last_name='Петров',
            workspace=other_workspace,
            is_confirmed=True,
        )
        KnowledgeDocument.objects.create(
            workspace=other_workspace,
            uploaded_by=other_user,
            uploaded_by_identifier=other_user.id,
            original_name='Чужая база.txt',
            file=f'knowledge_base/test/{uuid.uuid4()}.txt',
            size_bytes=10,
            mime_type='text/plain',
            sha256='b' * 64,
            status=KnowledgeDocumentStatus.READY,
        )

        response = self.client.get(self.status_url)

        self.assertEqual(response.data['status'], 'not_started')
        self.assertFalse(response.data['steps']['knowledge_base_completed'])

    def test_knowledge_upload_writes_onboarding_audit_events(self):
        response = self.client.post(
            '/api/ai/knowledge-base/files',
            {
                'files': SimpleUploadedFile(
                    'База.txt',
                    'Текст базы знаний'.encode(),
                    content_type='text/plain',
                ),
            },
            format='multipart',
            HTTP_X_REQUEST_ID=str(self.upload_correlation),
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        events = list(
            WorkspaceOnboardingAuditLog.objects.order_by('created_at').values_list(
                'event',
                flat=True,
            ),
        )
        self.assertEqual(
            events,
            [
                OnboardingAuditEvent.UPLOAD_STARTED,
                OnboardingAuditEvent.UPLOAD_SUCCESS,
            ],
        )
        self.assertFalse(
            WorkspaceOnboardingAuditLog.objects.exclude(
                correlation_id=self.upload_correlation,
            ).exists(),
        )

    def test_processing_first_document_updates_onboarding_automatically(self):
        self.client.post(self.materials_url)
        upload = self.client.post(
            '/api/ai/knowledge-base/files',
            {
                'files': SimpleUploadedFile(
                    'Автоматическая база.txt',
                    'Содержимое базы знаний'.encode(),
                    content_type='text/plain',
                ),
            },
            format='multipart',
        )
        document = KnowledgeDocument.objects.get(id=upload.data['files'][0]['id'])

        with self.captureOnCommitCallbacks(execute=True):
            result = process_knowledge_document(
                document.id,
                embedding_client=FakeEmbeddingClient(),
            )

        self.assertEqual(result, KnowledgeDocumentStatus.READY)
        state = WorkspaceOnboarding.objects.get(workspace=self.workspace)
        self.assertTrue(state.completed)
