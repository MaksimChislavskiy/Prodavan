import math
import tempfile
import uuid
from time import perf_counter
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
    WorkspaceOnboardingAuditLog,
)
from .onboarding import onboarding_knowledge_state_changed


class FastEmbeddingClient:
    def create_embeddings(self, texts):
        return [[1.0, 0.0] for _ in texts]


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class NewTzOnboardingContractTests(TestCase):
    status_url = '/api/user/onboarding-status'
    materials_url = '/api/user/onboarding/materials-viewed'
    video_correlation = uuid.UUID('11111111-1111-4111-8111-111111111111')
    pdf_correlation = uuid.UUID('22222222-2222-4222-8222-222222222222')
    materials_correlation = uuid.UUID('33333333-3333-4333-8333-333333333333')
    upload_correlation = uuid.UUID('44444444-4444-4444-8444-444444444444')
    worker_correlation = uuid.UUID('55555555-5555-4555-8555-555555555555')

    def setUp(self):
        self.media_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.media_dir.cleanup)
        self.settings_override = override_settings(MEDIA_ROOT=self.media_dir.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)

        self.workspace = Workspace.objects.create(name='Компания')
        self.user = User.objects.create_user(
            email='onboarding-contract@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            workspace=self.workspace,
            role=UserRole.ADMIN,
            is_confirmed=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _headers(self, request_id):
        return {
            'HTTP_X_REQUEST_ID': str(request_id),
            'HTTP_X_REAL_IP': '203.0.113.24',
            'REMOTE_ADDR': '172.18.0.5',
            'HTTP_USER_AGENT': 'ProdavanOnboardingContract/1.0',
        }

    def test_video_open_records_specific_and_generic_audit_with_metadata(self):
        response = self.client.post(
            self.materials_url,
            {'material': 'video'},
            format='json',
            **self._headers(self.video_correlation),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['steps']['materials_viewed'])
        events = list(
            WorkspaceOnboardingAuditLog.objects.order_by('created_at').values_list(
                'event',
                flat=True,
            ),
        )
        self.assertEqual(
            events,
            [
                OnboardingAuditEvent.VIDEO_OPENED,
                OnboardingAuditEvent.MATERIALS_VIEWED,
            ],
        )
        correlations = set()
        for audit in WorkspaceOnboardingAuditLog.objects.all():
            self.assertEqual(audit.user_identifier, self.user.id)
            self.assertEqual(audit.workspace_identifier, self.workspace.id)
            self.assertEqual(audit.ip, '203.0.113.24')
            self.assertEqual(audit.user_agent, 'ProdavanOnboardingContract/1.0')
            self.assertEqual(audit.correlation_id, self.video_correlation)
            self.assertIsInstance(audit.correlation_id, uuid.UUID)
            self.assertIsNotNone(audit.created_at)
            correlations.add(audit.correlation_id)
        self.assertEqual(correlations, {self.video_correlation})

    def test_non_uuid_request_id_is_replaced_by_one_flow_uuid(self):
        response = self.client.post(
            self.materials_url,
            {'material': 'video'},
            format='json',
            **self._headers('legacy-readable-request-id'),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        audits = list(WorkspaceOnboardingAuditLog.objects.all())
        self.assertEqual(len(audits), 2)
        correlations = {audit.correlation_id for audit in audits}
        self.assertEqual(len(correlations), 1)
        correlation_id = correlations.pop()
        self.assertIsInstance(correlation_id, uuid.UUID)
        self.assertNotEqual(str(correlation_id), 'legacy-readable-request-id')

    def test_pdf_open_after_materials_viewed_records_open_without_duplicate_step(self):
        self.client.post(
            self.materials_url,
            {'material': 'video'},
            format='json',
            **self._headers(self.video_correlation),
        )

        response = self.client.post(
            self.materials_url,
            {'material': 'pdf'},
            format='json',
            **self._headers(self.pdf_correlation),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            WorkspaceOnboardingAuditLog.objects.filter(
                event=OnboardingAuditEvent.MATERIALS_VIEWED,
            ).count(),
            1,
        )
        pdf_audit = WorkspaceOnboardingAuditLog.objects.get(
            event=OnboardingAuditEvent.PDF_OPENED,
        )
        self.assertEqual(pdf_audit.correlation_id, self.pdf_correlation)

    def test_bodyless_materials_viewed_remains_idempotent(self):
        first = self.client.post(self.materials_url)
        second = self.client.post(self.materials_url)

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
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
        self.assertIsInstance(audit.correlation_id, uuid.UUID)

    def test_upload_correlation_survives_background_processing_to_completion(self):
        materials = self.client.post(
            self.materials_url,
            {'material': 'pdf'},
            format='json',
            **self._headers(self.materials_correlation),
        )
        self.assertEqual(materials.status_code, status.HTTP_200_OK)

        upload = self.client.post(
            '/api/ai/knowledge-base/files',
            {
                'files': SimpleUploadedFile(
                    'База.txt',
                    'Текст базы знаний для онбординга'.encode('utf-8'),
                    content_type='text/plain',
                ),
            },
            format='multipart',
            **self._headers(self.upload_correlation),
        )
        self.assertEqual(upload.status_code, status.HTTP_202_ACCEPTED)
        document = KnowledgeDocument.objects.get(id=upload.data['files'][0]['id'])
        self.assertEqual(
            document.onboarding_correlation_id,
            str(self.upload_correlation),
        )

        with self.captureOnCommitCallbacks(execute=True):
            result = process_knowledge_document(
                document.id,
                embedding_client=FastEmbeddingClient(),
            )

        self.assertEqual(result, KnowledgeDocumentStatus.READY)
        completed = WorkspaceOnboardingAuditLog.objects.get(
            event=OnboardingAuditEvent.COMPLETED,
        )
        self.assertEqual(completed.correlation_id, self.upload_correlation)
        self.assertEqual(
            completed.details['reason']['trigger_document_id'],
            str(document.id),
        )

    @patch('workspaces.onboarding.broadcast_workspace_event')
    def test_onboarding_status_websocket_contains_flow_correlation(self, broadcast):
        self.client.post(self.materials_url)
        broadcast.reset_mock()
        document = KnowledgeDocument.objects.create(
            workspace=self.workspace,
            uploaded_by=self.user,
            uploaded_by_identifier=self.user.id,
            original_name='База.txt',
            file='knowledge_base/test/correlation.txt',
            size_bytes=10,
            mime_type='text/plain',
            sha256='a' * 64,
            status=KnowledgeDocumentStatus.READY,
        )

        with self.captureOnCommitCallbacks(execute=True):
            onboarding_knowledge_state_changed(
                workspace_id=self.workspace.id,
                previous_has_ready=False,
                current_has_ready=True,
                user_id=self.user.id,
                correlation_id=self.worker_correlation,
                trigger_document_id=document.id,
            )

        broadcast.assert_called_once()
        payload = broadcast.call_args.args[1]
        self.assertEqual(payload['event'], 'onboarding_status_updated')
        self.assertEqual(payload['correlation_id'], str(self.worker_correlation))
        self.assertEqual(payload['data']['status'], 'completed')

    def test_status_application_p95_is_within_300_ms(self):
        samples = []
        warmup = self.client.get(self.status_url)
        self.assertEqual(warmup.status_code, status.HTTP_200_OK)

        for _ in range(20):
            started = perf_counter()
            response = self.client.get(self.status_url)
            samples.append(perf_counter() - started)
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        ordered = sorted(samples)
        p95 = ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]
        self.assertLessEqual(
            p95,
            0.3,
            f'GET /api/user/onboarding-status application p95 is {p95:.3f}s',
        )
