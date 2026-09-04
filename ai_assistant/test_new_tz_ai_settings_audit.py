from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from users.models import User

from .models import (
    AIAuditAction,
    AIAuditLog,
    AISettings,
    KnowledgeDocument,
    KnowledgeDocumentStatus,
)


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class NewTzAISettingsAuditTests(TestCase):
    settings_url = '/api/ai/settings'
    files_url = '/api/ai/knowledge-base/files'
    login_url = '/api/auth/login'
    request_meta = {
        'REMOTE_ADDR': '203.0.113.15',
        'HTTP_USER_AGENT': 'ProdavanAuditContract/1.0',
    }

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='ai-audit@example.com',
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

    def _request_headers(self):
        return {**self.auth, **self.request_meta}

    def _assert_request_metadata(self, audit):
        self.assertEqual(audit.user_identifier, self.user.id)
        self.assertEqual(audit.workspace_id, self.user.workspace_id)
        self.assertEqual(audit.ip, '203.0.113.15')
        self.assertEqual(audit.user_agent, 'ProdavanAuditContract/1.0')
        self.assertIsNotNone(audit.created_at)

    def test_enabling_autopilot_writes_required_audit_action_and_metadata(self):
        response = self.client.patch(
            self.settings_url,
            {'version': 0, 'autopilot_enabled': True},
            format='json',
            **self._request_headers(),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        audit = AIAuditLog.objects.get()
        self.assertEqual(audit.action, AIAuditAction.AUTOPILOT_ENABLED)
        self.assertEqual(audit.old_value, False)
        self.assertEqual(audit.new_value, True)
        self.assertEqual(
            audit.changes,
            {'autopilot_enabled': {'old': False, 'new': True}},
        )
        self._assert_request_metadata(audit)

    def test_disabling_autopilot_writes_required_audit_action(self):
        AISettings.objects.create(
            workspace=self.user.workspace,
            autopilot_enabled=True,
        )

        response = self.client.patch(
            self.settings_url,
            {'version': 0, 'autopilot_enabled': False},
            format='json',
            **self._request_headers(),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        audit = AIAuditLog.objects.get()
        self.assertEqual(audit.action, AIAuditAction.AUTOPILOT_DISABLED)
        self.assertEqual(audit.old_value, True)
        self.assertEqual(audit.new_value, False)
        self.assertEqual(
            audit.changes,
            {'autopilot_enabled': {'old': True, 'new': False}},
        )
        self._assert_request_metadata(audit)

    def test_instruction_audit_records_old_new_ip_and_user_agent(self):
        AISettings.objects.create(
            workspace=self.user.workspace,
            instruction='Старая инструкция',
        )

        response = self.client.patch(
            self.settings_url,
            {'version': 0, 'instruction': 'Новая инструкция'},
            format='json',
            **self._request_headers(),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        audit = AIAuditLog.objects.get(action=AIAuditAction.INSTRUCTION_UPDATED)
        self.assertEqual(audit.old_value, 'Старая инструкция')
        self.assertEqual(audit.new_value, 'Новая инструкция')
        self._assert_request_metadata(audit)

    def test_document_upload_retry_and_delete_record_request_metadata(self):
        upload = SimpleUploadedFile(
            'facts.txt',
            b'Prodavan knowledge base text.',
            content_type='text/plain',
        )
        response = self.client.post(
            self.files_url,
            {'files': [upload]},
            format='multipart',
            **self._request_headers(),
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        document = KnowledgeDocument.objects.get(id=response.data['files'][0]['id'])
        upload_audit = AIAuditLog.objects.get(action=AIAuditAction.DOCUMENT_UPLOADED)
        self._assert_request_metadata(upload_audit)

        document.status = KnowledgeDocumentStatus.FAILED
        document.error_reason = 'Тестовая ошибка обработки'
        document.save(update_fields=('status', 'error_reason', 'updated_at'))
        retry_response = self.client.post(
            f'{self.files_url}/{document.id}/retry',
            {},
            format='json',
            **self._request_headers(),
        )
        self.assertEqual(retry_response.status_code, status.HTTP_202_ACCEPTED)
        retry_audit = AIAuditLog.objects.get(action=AIAuditAction.DOCUMENT_RETRY)
        self._assert_request_metadata(retry_audit)

        delete_response = self.client.delete(
            f'{self.files_url}/{document.id}',
            **self._request_headers(),
        )
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        delete_audit = AIAuditLog.objects.get(action=AIAuditAction.DOCUMENT_DELETED)
        self._assert_request_metadata(delete_audit)

    def test_version_conflict_message_matches_new_tz(self):
        AISettings.objects.create(
            workspace=self.user.workspace,
            version=2,
            instruction='Актуальная инструкция',
        )

        response = self.client.patch(
            self.settings_url,
            {'version': 1, 'instruction': 'Устаревшее изменение'},
            format='json',
            **self.auth,
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(
            response.data['error']['message'],
            'Настройки были изменены другим пользователем или в другой вкладке. '
            'Обновите страницу и повторите попытку.',
        )
