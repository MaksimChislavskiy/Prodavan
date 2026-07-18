import io
import shutil
import tempfile
import uuid
import zipfile
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User, UserRole

from .knowledge import MAX_FILE_SIZE
from .models import (
    AIAuditAction,
    AIAuditLog,
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeDocumentStatus,
)
from .processing import (
    PROCESSING_TIMEOUT,
    PROCESSING_TIMEOUT_REASON,
    extract_document_text,
    fail_timed_out_knowledge_documents,
    process_knowledge_document,
    process_pending_knowledge_documents,
    split_into_chunks,
)


class FakeEmbeddingClient:
    def create_embeddings(self, texts):
        return [[float(len(text)), 1.0] for text in texts]


class TimeoutDuringEmbeddingClient(FakeEmbeddingClient):
    def __init__(self, document_id):
        self.document_id = document_id

    def create_embeddings(self, texts):
        now = timezone.now()
        KnowledgeDocument.objects.filter(id=self.document_id).update(
            processing_started_at=now - PROCESSING_TIMEOUT - timedelta(seconds=1),
        )
        fail_timed_out_knowledge_documents(now=now)
        return super().create_embeddings(texts)


def text_upload(name='Инструкция.txt', content='Полезный текст для клиента.'):
    return SimpleUploadedFile(name, content.encode('utf-8'), content_type='text/plain')


def csv_upload(name='Товары.csv'):
    return SimpleUploadedFile(
        name,
        'Название,Цена\nТовар,100'.encode('utf-8'),
        content_type='text/csv',
    )


def docx_bytes(text='Текст из документа'):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr(
            '[Content_Types].xml',
            '<?xml version="1.0"?><Types '
            'xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        )
        archive.writestr(
            'word/document.xml',
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<w:document '
            'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f'<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body>'
            '</w:document>',
        )
    return output.getvalue()


def docx_upload(name='Описание.docx', text='Текст из документа'):
    return SimpleUploadedFile(
        name,
        docx_bytes(text),
        content_type=(
            'application/vnd.openxmlformats-officedocument.'
            'wordprocessingml.document'
        ),
    )


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class KnowledgeBaseApiTests(TestCase):
    url = '/api/ai/knowledge-base/files'
    login_url = '/api/auth/login'

    def setUp(self):
        cache.clear()
        self.media_root = tempfile.mkdtemp(prefix='prodavan-kb-tests-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(shutil.rmtree, self.media_root, True)
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

    def _login(self, email='owner@example.com', password='StrongPass1'):
        response = self.client.post(
            self.login_url,
            {'email': email, 'password': password},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data['access_token']

    def test_upload_is_rate_limited_per_workspace(self):
        access = self._login()
        auth = self._auth(access)

        for _ in range(30):
            response = self.client.post(self.url, {}, format='multipart', **auth)
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        limited = self.client.post(self.url, {}, format='multipart', **auth)

        self.assertEqual(limited.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    @staticmethod
    def _auth(access):
        return {'HTTP_AUTHORIZATION': f'Bearer {access}'}

    def _upload(self, uploaded_files, access=None):
        access = access or self._login()
        return self.client.post(
            self.url,
            {'files': uploaded_files},
            format='multipart',
            **self._auth(access),
        )

    def _document(self, **overrides):
        defaults = {
            'workspace': self.user.workspace,
            'uploaded_by': self.user,
            'uploaded_by_identifier': self.user.id,
            'original_name': 'Документ.txt',
            'file': f'knowledge_base/test/{uuid.uuid4()}.txt',
            'size_bytes': 10,
            'mime_type': 'text/plain',
            'sha256': 'a' * 64,
        }
        defaults.update(overrides)
        return KnowledgeDocument.objects.create(**defaults)

    def test_endpoints_require_authentication(self):
        list_response = self.client.get(self.url)
        upload_response = self.client.post(self.url, {}, format='multipart')

        self.assertEqual(list_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(upload_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_non_admin_cannot_access_knowledge_base(self):
        self.user.role = UserRole.USER
        self.user.save(update_fields=('role', 'updated_at'))
        access = self._login()

        response = self.client.get(self.url, **self._auth(access))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_upload_accepts_multiple_supported_files_and_writes_audit(self):
        access = self._login()

        response = self._upload(
            [text_upload(), csv_upload(), docx_upload()],
            access,
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(response.data['accepted'], 3)
        self.assertTrue(
            all(item['status'] == 'processing' for item in response.data['files']),
        )
        self.assertEqual(KnowledgeDocument.objects.count(), 3)
        self.assertEqual(
            AIAuditLog.objects.filter(
                action=AIAuditAction.DOCUMENT_UPLOADED,
            ).count(),
            3,
        )
        for document in KnowledgeDocument.objects.all():
            self.assertTrue(default_storage.exists(document.file.name))
            self.assertNotIn(document.original_name, document.file.name)

    def test_duplicate_files_are_allowed(self):
        access = self._login()

        first = self._upload([text_upload()], access)
        second = self._upload([text_upload()], access)

        self.assertEqual(first.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(second.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(KnowledgeDocument.objects.count(), 2)

    def test_upload_rejects_missing_too_many_and_unsupported_files(self):
        access = self._login()
        missing = self.client.post(
            self.url,
            {},
            format='multipart',
            **self._auth(access),
        )
        too_many = self._upload(
            [text_upload(name=f'Документ_{index}.txt') for index in range(21)],
            access,
        )
        unsupported = self._upload(
            [SimpleUploadedFile('script.exe', b'MZ executable')],
            access,
        )

        self.assertEqual(missing.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(missing.data['error']['code'], 'FILES_REQUIRED')
        self.assertEqual(too_many.data['error']['code'], 'TOO_MANY_FILES')
        self.assertEqual(
            unsupported.data['error']['code'],
            'UNSUPPORTED_FILE_TYPE',
        )

    def test_upload_checks_content_filename_and_size(self):
        access = self._login()
        invalid_content = self._upload(
            [SimpleUploadedFile('Файл.pdf', b'not a pdf')],
            access,
        )
        invalid_name = self._upload([text_upload('Файл(1).txt')], access)
        with patch('ai_assistant.knowledge.MAX_FILE_SIZE', 3):
            too_large = self._upload([text_upload(content='1234')], access)

        self.assertEqual(
            invalid_content.data['error']['code'],
            'INVALID_FILE_CONTENT',
        )
        self.assertEqual(invalid_name.data['error']['code'], 'INVALID_FILE_NAME')
        self.assertEqual(too_large.status_code, status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        self.assertEqual(too_large.data['error']['code'], 'FILE_TOO_LARGE')

    def test_workspace_file_count_and_storage_limits_are_atomic(self):
        access = self._login()
        self._document(size_bytes=2)
        with patch('ai_assistant.knowledge.MAX_FILES_PER_WORKSPACE', 1):
            count_response = self._upload([text_upload()], access)
        with patch('ai_assistant.knowledge.MAX_WORKSPACE_STORAGE', 3):
            storage_response = self._upload(
                [text_upload(content='12')],
                access,
            )

        self.assertEqual(count_response.data['error']['code'], 'FILE_COUNT_LIMIT')
        self.assertEqual(storage_response.data['error']['code'], 'STORAGE_LIMIT')
        self.assertEqual(KnowledgeDocument.objects.count(), 1)

    def test_list_supports_pagination_search_filter_sort_and_storage(self):
        self._document(original_name='Бета.txt', status=KnowledgeDocumentStatus.FAILED)
        self._document(original_name='Альфа.txt', status=KnowledgeDocumentStatus.READY)
        access = self._login()

        response = self.client.get(
            self.url,
            {
                'page': 1,
                'page_size': 1,
                'search': 'Альфа',
                'status': 'ready',
                'sort': 'name:asc',
            },
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 1)
        self.assertEqual(response.data['files'][0]['name'], 'Альфа.txt')
        self.assertEqual(response.data['storage']['files_count'], 2)
        self.assertEqual(response.data['storage']['used_bytes'], 20)

    def test_list_rejects_invalid_query_parameters(self):
        access = self._login()
        urls = (
            f'{self.url}?page=0',
            f'{self.url}?page_size=101',
            f'{self.url}?status=unknown',
            f'{self.url}?sort=random',
        )

        for url in urls:
            with self.subTest(url=url):
                response = self.client.get(url, **self._auth(access))
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_detail_is_workspace_scoped(self):
        other_user = User.objects.create_user(
            email='other@example.com',
            password='StrongPass2',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        document = self._document(workspace=other_user.workspace)
        access = self._login()

        response = self.client.get(
            f'{self.url}/{document.id}',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_delete_soft_deletes_file_chunks_and_writes_audit(self):
        access = self._login()
        upload_response = self._upload([text_upload()], access)
        document = KnowledgeDocument.objects.get(
            id=upload_response.data['files'][0]['id'],
        )
        KnowledgeChunk.objects.create(
            document=document,
            workspace=document.workspace,
            position=0,
            text='chunk',
            token_count=1,
            embedding=[1.0],
        )
        file_name = document.file.name

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.delete(
                f'{self.url}/{document.id}',
                **self._auth(access),
            )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        document.refresh_from_db()
        self.assertTrue(document.is_deleted)
        self.assertFalse(default_storage.exists(file_name))
        self.assertFalse(KnowledgeChunk.objects.filter(document=document).exists())
        self.assertTrue(
            AIAuditLog.objects.filter(
                action=AIAuditAction.DOCUMENT_DELETED,
                workspace=self.user.workspace,
            ).exists(),
        )

    def test_retry_only_accepts_failed_document(self):
        failed = self._document(
            status=KnowledgeDocumentStatus.FAILED,
            error_reason='Ошибка индексации',
        )
        processing = self._document(original_name='Другой.txt')
        access = self._login()

        success = self.client.post(
            f'{self.url}/{failed.id}/retry',
            **self._auth(access),
        )
        conflict = self.client.post(
            f'{self.url}/{processing.id}/retry',
            **self._auth(access),
        )

        self.assertEqual(success.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(success.data['status'], 'processing')
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(
            AIAuditLog.objects.filter(action=AIAuditAction.DOCUMENT_RETRY).exists(),
        )

    def test_processor_extracts_chunks_embeds_and_marks_ready(self):
        access = self._login()
        long_text = ' '.join(f'слово{index}' for index in range(1000))
        response = self._upload([text_upload(content=long_text)], access)
        document = KnowledgeDocument.objects.get(id=response.data['files'][0]['id'])

        result = process_knowledge_document(
            document.id,
            embedding_client=FakeEmbeddingClient(),
        )

        document.refresh_from_db()
        self.assertEqual(result, KnowledgeDocumentStatus.READY)
        self.assertEqual(document.status, KnowledgeDocumentStatus.READY)
        self.assertEqual(document.processing_attempts, 1)
        self.assertIsNotNone(document.processed_at)
        chunks = list(document.chunks.all())
        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0].token_count, 750)
        self.assertEqual(len(chunks[0].embedding), 2)

    @override_settings(
        AI_EMBEDDINGS_BASE_URL='',
        AI_EMBEDDINGS_MODEL='',
    )
    def test_processor_marks_failed_when_embeddings_are_not_configured(self):
        access = self._login()
        response = self._upload([text_upload()], access)
        document = KnowledgeDocument.objects.get(id=response.data['files'][0]['id'])

        result = process_knowledge_document(document.id)

        document.refresh_from_db()
        self.assertEqual(result, KnowledgeDocumentStatus.FAILED)
        self.assertEqual(document.status, KnowledgeDocumentStatus.FAILED)
        self.assertEqual(document.error_reason, 'Сервис эмбеддингов не настроен.')

    def test_processing_timeout_uses_strict_thirty_minute_boundary(self):
        now = timezone.now()
        timed_out = self._document(
            original_name='Просрочен.txt',
            processing_started_at=now - PROCESSING_TIMEOUT - timedelta(microseconds=1),
        )
        at_boundary = self._document(
            original_name='На границе.txt',
            processing_started_at=now - PROCESSING_TIMEOUT,
        )
        active = self._document(
            original_name='Активен.txt',
            processing_started_at=now - timedelta(minutes=10),
        )
        deleted = self._document(
            original_name='Удалён.txt',
            processing_started_at=now - PROCESSING_TIMEOUT - timedelta(minutes=1),
            is_deleted=True,
            deleted_at=now,
        )

        count = fail_timed_out_knowledge_documents(now=now, limit=10)

        self.assertEqual(count, 1)
        timed_out.refresh_from_db()
        self.assertEqual(timed_out.status, KnowledgeDocumentStatus.FAILED)
        self.assertEqual(timed_out.error_reason, PROCESSING_TIMEOUT_REASON)
        self.assertIsNone(timed_out.processing_started_at)
        self.assertEqual(timed_out.processed_at, now)
        for document in (at_boundary, active, deleted):
            document.refresh_from_db()
            self.assertEqual(document.status, KnowledgeDocumentStatus.PROCESSING)

    def test_pending_worker_reports_timeout_without_reclaiming_active_lock(self):
        now = timezone.now()
        timed_out = self._document(
            original_name='Просрочен.txt',
            processing_started_at=now - PROCESSING_TIMEOUT - timedelta(seconds=1),
        )
        active = self._document(
            original_name='Активен.txt',
            processing_started_at=now - timedelta(minutes=10),
        )

        result = process_pending_knowledge_documents(
            limit=10,
            embedding_client=FakeEmbeddingClient(),
            now=now,
        )

        self.assertEqual(
            result,
            {'processed': 1, 'ready': 0, 'failed': 1, 'timed_out': 1},
        )
        timed_out.refresh_from_db()
        active.refresh_from_db()
        self.assertEqual(timed_out.status, KnowledgeDocumentStatus.FAILED)
        self.assertEqual(active.status, KnowledgeDocumentStatus.PROCESSING)

    def test_late_worker_cannot_overwrite_processing_timeout(self):
        access = self._login()
        response = self._upload([text_upload()], access)
        document = KnowledgeDocument.objects.get(id=response.data['files'][0]['id'])

        result = process_knowledge_document(
            document.id,
            embedding_client=TimeoutDuringEmbeddingClient(document.id),
        )

        document.refresh_from_db()
        self.assertIsNone(result)
        self.assertEqual(document.status, KnowledgeDocumentStatus.FAILED)
        self.assertEqual(document.error_reason, PROCESSING_TIMEOUT_REASON)
        self.assertFalse(document.chunks.exists())

    def test_timeout_cleanup_rejects_non_positive_limit(self):
        with self.assertRaisesRegex(ValueError, 'limit'):
            fail_timed_out_knowledge_documents(limit=0)

    def test_docx_and_csv_extractors_return_plain_text(self):
        access = self._login()
        response = self._upload([docx_upload(), csv_upload()], access)
        documents = {
            item.original_name: item for item in KnowledgeDocument.objects.all()
        }

        docx_text = extract_document_text(documents['Описание.docx'])
        csv_text = extract_document_text(documents['Товары.csv'])

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertIn('Текст из документа', docx_text)
        self.assertIn('Название | Цена', csv_text)

    def test_chunker_uses_overlap(self):
        text = ' '.join(str(index) for index in range(800))

        chunks = split_into_chunks(text)

        first_tokens = chunks[0][0].split()
        second_tokens = chunks[1][0].split()
        self.assertEqual(first_tokens[-100:], second_tokens[:100])

    def test_constant_matches_twenty_megabytes(self):
        self.assertEqual(MAX_FILE_SIZE, 20 * 1024 * 1024)
