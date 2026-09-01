import math
from time import perf_counter

from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User, UserRole

from .models import (
    OnboardingAuditEvent,
    Workspace,
    WorkspaceOnboardingAuditLog,
)


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class NewTzOnboardingContractTests(TestCase):
    status_url = '/api/user/onboarding-status'
    materials_url = '/api/user/onboarding/materials-viewed'

    def setUp(self):
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
            'HTTP_X_REQUEST_ID': request_id,
            'HTTP_X_REAL_IP': '203.0.113.24',
            'REMOTE_ADDR': '172.18.0.5',
            'HTTP_USER_AGENT': 'ProdavanOnboardingContract/1.0',
        }

    def test_video_open_records_specific_and_generic_audit_with_metadata(self):
        response = self.client.post(
            self.materials_url,
            {'material': 'video'},
            format='json',
            **self._headers('onboarding-video-1'),
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
        for audit in WorkspaceOnboardingAuditLog.objects.all():
            self.assertEqual(audit.user_identifier, self.user.id)
            self.assertEqual(audit.workspace_identifier, self.workspace.id)
            self.assertEqual(audit.ip, '203.0.113.24')
            self.assertEqual(audit.user_agent, 'ProdavanOnboardingContract/1.0')
            self.assertEqual(audit.correlation_id, 'onboarding-video-1')
            self.assertIsNotNone(audit.created_at)

    def test_pdf_open_after_materials_viewed_records_open_without_duplicate_step(self):
        self.client.post(
            self.materials_url,
            {'material': 'video'},
            format='json',
            **self._headers('onboarding-video-1'),
        )

        response = self.client.post(
            self.materials_url,
            {'material': 'pdf'},
            format='json',
            **self._headers('onboarding-pdf-1'),
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
        self.assertEqual(pdf_audit.correlation_id, 'onboarding-pdf-1')

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
