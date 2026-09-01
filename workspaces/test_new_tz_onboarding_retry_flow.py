import tempfile
import uuid

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from ai_assistant.models import (
    AIAuditAction,
    AIAuditLog,
    KnowledgeDocument,
    KnowledgeDocumentStatus,
)
from ai_assistant.processing import process_knowledge_document
from users.models import User, UserRole

from .models import OnboardingAuditEvent, Workspace, WorkspaceOnboardingAuditLog


class FastEmbeddingClient:
    def create_embeddings(self, texts):
        return [[1.0, 0.0] for _ in texts]


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class NewTzOnboardingRetryFlowTests(TestCase):
    materials_url = '/api/user/onboarding/materials-viewed'
    files_url = '/api/ai/knowledge-base/files'
    retry_correlation = uuid.UUID('99999999-9999-4999-8999-999999999999')

    def setUp(self):
        self.media_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.media_dir.cleanup)
        self.settings_override = override_settings(MEDIA_ROOT=self.media_dir.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)

        self.workspace = Workspace.objects.create(name='Retry company')
        self.user = User.objects.create_user(
            email='onboarding-retry@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            workspace=self.workspace,
            role=UserRole.ADMIN,
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _retry_headers(self):
        return {
            'HTTP_X_REQUEST_ID': str(self.retry_correlation),
            'HTTP_X_REAL_IP': '203.0.113.29',
            'REMOTE_ADDR': '172.18.0.5',
            'HTTP_USER_AGENT': 'ProdavanRetryFlow/1.0',
        }

    def test_retry_metadata_survives_worker_to_onboarding_completed(self):
        materials = self.client.post(
            self.materials_url,
            {'material': 'pdf'},
            format='json',
        )
        self.assertEqual(materials.status_code, status.HTTP_200_OK)
        self.assertEqual(materials.data['status'], 'in_progress')

        upload = self.client.post(
            self.files_url,
            {
                'files': SimpleUploadedFile(
                    'retry.txt',
                    'База знаний после повторной обработки'.encode('utf-8'),
                    content_type='text/plain',
                ),
            },
            format='multipart',
        )
        self.assertEqual(upload.status_code, status.HTTP_202_ACCEPTED)
        document = KnowledgeDocument.objects.get(id=upload.data['files'][0]['id'])
        document.status = KnowledgeDocumentStatus.FAILED
        document.error_reason = 'Temporary processing error'
        document.save(update_fields=('status', 'error_reason', 'updated_at'))

        retry = self.client.post(
            f'{self.files_url}/{document.id}/retry',
            {},
            format='json',
            **self._retry_headers(),
        )
        self.assertEqual(retry.status_code, status.HTTP_202_ACCEPTED)

        document.refresh_from_db()
        self.assertEqual(
            document.onboarding_correlation_id,
            str(self.retry_correlation),
        )
        retry_audit = AIAuditLog.objects.get(action=AIAuditAction.DOCUMENT_RETRY)
        self.assertEqual(retry_audit.request_id, self.retry_correlation)
        self.assertEqual(retry_audit.ip, '203.0.113.29')
        self.assertEqual(retry_audit.user_agent, 'ProdavanRetryFlow/1.0')

        with self.captureOnCommitCallbacks(execute=True):
            result = process_knowledge_document(
                document.id,
                embedding_client=FastEmbeddingClient(),
            )

        self.assertEqual(result, KnowledgeDocumentStatus.READY)
        completed = WorkspaceOnboardingAuditLog.objects.get(
            event=OnboardingAuditEvent.COMPLETED,
        )
        self.assertEqual(completed.correlation_id, self.retry_correlation)
        self.assertEqual(completed.ip, '203.0.113.29')
        self.assertEqual(completed.user_agent, 'ProdavanRetryFlow/1.0')
        self.assertEqual(
            completed.details['reason']['trigger_document_id'],
            str(document.id),
        )
