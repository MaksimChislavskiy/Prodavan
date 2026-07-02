from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from .models import (
    DeletedEmailReservation,
    ProfileAuditAction,
    ProfileAuditLog,
    RefreshToken,
    User,
)


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class ProfileApiTests(TestCase):
    profile_url = '/api/profile'
    avatar_url = '/api/profile/avatar'
    change_password_url = '/api/profile/change-password'
    login_url = '/api/auth/login'
    register_url = '/api/auth/register'

    def setUp(self):
        cache.clear()
        self.media_dir = TemporaryDirectory()
        self.addCleanup(self.media_dir.cleanup)
        self.media_override = override_settings(
            MEDIA_ROOT=self.media_dir.name,
            EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
        )
        self.media_override.enable()
        self.addCleanup(self.media_override.disable)
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='owner@example.com',
            password='StrongPass1',
            first_name='Иван',
            last_name='Иванов',
            is_confirmed=True,
        )

    def _login(self):
        response = self.client.post(
            self.login_url,
            {'email': 'owner@example.com', 'password': 'StrongPass1'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data['access_token']

    def _auth(self, token):
        return {'HTTP_AUTHORIZATION': f'Bearer {token}'}

    @staticmethod
    def _image_file(width=300, height=240, image_format='PNG'):
        output = BytesIO()
        Image.new('RGB', (width, height), color=(50, 120, 200)).save(
            output,
            format=image_format,
        )
        extension = 'jpg' if image_format == 'JPEG' else image_format.lower()
        return SimpleUploadedFile(
            f'avatar.{extension}',
            output.getvalue(),
            content_type=f'image/{extension}',
        )

    def test_profile_requires_authentication(self):
        response = self.client.get(self.profile_url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_get_profile_returns_contract_fields(self):
        access = self._login()

        response = self.client.get(self.profile_url, **self._auth(access))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['id'], str(self.user.id))
        self.assertEqual(response.data['name'], 'Иван')
        self.assertEqual(response.data['version'], 0)
        self.assertIsNone(response.data['avatar'])

    def test_patch_profile_validates_and_increments_version(self):
        access = self._login()

        response = self.client.patch(
            self.profile_url,
            {
                'version': 0,
                'name': 'Иван Петров',
                'position': 'Менеджер по продажам',
                'phone': '+7 (999) 123-45-67',
            },
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['version'], 1)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, 'Иван Петров')
        self.assertEqual(self.user.position, 'Менеджер по продажам')
        log = ProfileAuditLog.objects.get(
            user=self.user,
            action=ProfileAuditAction.PROFILE_UPDATED,
        )
        self.assertEqual(
            set(log.changes['fields']),
            {'name', 'phone', 'position'},
        )

    def test_patch_profile_returns_409_for_stale_version(self):
        access = self._login()
        self.client.patch(
            self.profile_url,
            {'version': 0, 'name': 'Иван Петров'},
            format='json',
            **self._auth(access),
        )

        response = self.client.patch(
            self.profile_url,
            {'version': 0, 'name': 'Иван Сидоров'},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(
            response.data,
            {'error': 'version_conflict', 'current_version': 1},
        )

    def test_patch_profile_rejects_invalid_phone_and_position(self):
        access = self._login()

        response = self.client.patch(
            self.profile_url,
            {'version': 0, 'position': 'CEO 2', 'phone': '+7 12'},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('position', response.data)
        self.assertIn('phone', response.data)

    def test_patch_profile_rejects_email_used_by_another_user(self):
        User.objects.create_user(
            email='second@example.com',
            password='StrongPass1',
            first_name='Пётр',
            last_name='Петров',
            is_confirmed=True,
        )
        access = self._login()

        response = self.client.patch(
            self.profile_url,
            {'version': 0, 'email': 'second@example.com'},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['email'][0],
            'Этот email уже зарегистрирован.',
        )

    def test_avatar_upload_creates_three_square_versions(self):
        access = self._login()

        response = self.client.post(
            self.avatar_url,
            {'avatar': self._image_file()},
            format='multipart',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.avatar)
        self.assertTrue(self.user.avatar_small)
        self.assertTrue(self.user.avatar_medium)
        with Image.open(self.user.avatar.path) as image:
            self.assertEqual(image.width, image.height)
        with Image.open(self.user.avatar_small.path) as image:
            self.assertEqual(image.size, (40, 40))
        with Image.open(self.user.avatar_medium.path) as image:
            self.assertEqual(image.size, (160, 160))
        self.assertIn('?v=1', response.data['avatar_small'])

    def test_avatar_rejects_small_and_oversized_files(self):
        access = self._login()
        small_response = self.client.post(
            self.avatar_url,
            {'avatar': self._image_file(199, 250)},
            format='multipart',
            **self._auth(access),
        )
        oversized = SimpleUploadedFile(
            'large.png',
            b'x' * (5 * 1024 * 1024 + 1),
            content_type='image/png',
        )
        large_response = self.client.post(
            self.avatar_url,
            {'avatar': oversized},
            format='multipart',
            **self._auth(access),
        )

        self.assertEqual(small_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            large_response.status_code,
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )

    def test_delete_avatar_removes_database_values_and_files(self):
        access = self._login()
        self.client.post(
            self.avatar_url,
            {'avatar': self._image_file()},
            format='multipart',
            **self._auth(access),
        )
        self.user.refresh_from_db()
        paths = [
            Path(self.user.avatar.path),
            Path(self.user.avatar_small.path),
            Path(self.user.avatar_medium.path),
        ]

        response = self.client.delete(self.avatar_url, **self._auth(access))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.user.refresh_from_db()
        self.assertFalse(self.user.avatar)
        self.assertTrue(all(not path.exists() for path in paths))

    def test_change_password_revokes_sessions_and_old_access(self):
        access = self._login()

        response = self.client.post(
            self.change_password_url,
            {
                'current_password': 'StrongPass1',
                'new_password': 'NewStrong1',
            },
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('NewStrong1'))
        self.assertFalse(
            RefreshToken.objects.filter(user=self.user, revoked=False).exists(),
        )
        old_access_response = self.client.get(
            self.profile_url,
            **self._auth(access),
        )
        self.assertEqual(
            old_access_response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_delete_profile_anonymizes_and_quarantines_email(self):
        access = self._login()

        response = self.client.delete(
            self.profile_url,
            {'version': 0},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
        self.assertTrue(self.user.is_deleted)
        self.assertTrue(self.user.email.startswith('deleted-'))
        self.assertEqual(self.user.first_name, 'Удалённый')
        self.assertTrue(
            DeletedEmailReservation.objects.filter(
                user_identifier=self.user.id,
            ).exists(),
        )

        register_response = self.client.post(
            self.register_url,
            {
                'name': 'Иван',
                'surname': 'Иванов',
                'email': 'owner@example.com',
                'password': 'StrongPass1',
            },
            format='json',
        )
        self.assertEqual(
            register_response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            register_response.data['email'][0],
            'Этот e-mail временно недоступен для повторной регистрации.',
        )

    def test_delete_profile_checks_version(self):
        access = self._login()
        self.user.version = 2
        self.user.save(update_fields=('version', 'updated_at'))

        response = self.client.delete(
            self.profile_url,
            {'version': 1},
            format='json',
            **self._auth(access),
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
