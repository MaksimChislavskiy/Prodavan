import math
import shutil
import tempfile
from time import perf_counter

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .knowledge import MAX_FILE_SIZE
from .models import KnowledgeDocument, KnowledgeDocumentStatus


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class NewTzAISettingsNfrRegressionTests(TestCase):
    settings_url = '/api/ai/settings'
    files_url = '/api/ai/knowledge-base/files'
    login_url = '/api/auth/login'
    samples = 20

    def setUp(self):
        cache.clear()
        self.media_root = tempfile.mkdtemp(prefix='prodavan-ai-nfr-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(shutil.rmtree, self.media_root, True)

        self.client = APIClient()
        self.user = User.objects.create_user(
            email='ai-nfr@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )
        login_response = self.client.post(
            self.login_url,
            {'email': self.user.email, 'password': 'StrongPass1'},
            format='json',
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        self.auth = {
            'HTTP_AUTHORIZATION': f"Bearer {login_response.data['access_token']}",
        }

    @staticmethod
    def _p95(samples):
        ordered = sorted(samples)
        index = max(0, math.ceil(len(ordered) * 0.95) - 1)
        return ordered[index]

    def _measure_get(self, url):
        durations = []
        warmup = self.client.get(url, **self.auth)
        self.assertEqual(warmup.status_code, status.HTTP_200_OK)
        for _ in range(self.samples):
            started = perf_counter()
            response = self.client.get(url, **self.auth)
            durations.append(perf_counter() - started)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
        return self._p95(durations)

    def test_settings_get_application_p95_is_within_500_ms(self):
        p95 = self._measure_get(self.settings_url)

        self.assertLessEqual(
            p95,
            0.5,
            f'GET /api/ai/settings application p95 is {p95:.3f}s',
        )

    def test_knowledge_list_50_application_p95_is_within_one_second(self):
        KnowledgeDocument.objects.bulk_create([
            KnowledgeDocument(
                workspace=self.user.workspace,
                uploaded_by=self.user,
                uploaded_by_identifier=self.user.id,
                original_name=f'document-{index:02d}.txt',
                file=f'knowledge_base/test/document-{index:02d}.txt',
                size_bytes=128,
                mime_type='text/plain',
                sha256=f'{index:064x}',
                status=KnowledgeDocumentStatus.READY,
            )
            for index in range(50)
        ])

        p95 = self._measure_get(f'{self.files_url}?page=1&page_size=50')

        self.assertLessEqual(
            p95,
            1.0,
            f'GET /api/ai/knowledge-base/files application p95 is {p95:.3f}s',
        )

    def test_20_mib_upload_application_time_is_within_ten_seconds(self):
        upload = SimpleUploadedFile(
            'nfr-20mb.txt',
            b'a' * MAX_FILE_SIZE,
            content_type='text/plain',
        )

        started = perf_counter()
        response = self.client.post(
            self.files_url,
            {'files': [upload]},
            format='multipart',
            **self.auth,
        )
        duration = perf_counter() - started

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertLessEqual(
            duration,
            10.0,
            f'20 MiB upload application time is {duration:.3f}s',
        )
