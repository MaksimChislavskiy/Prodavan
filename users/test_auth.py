import hashlib

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from .models import RefreshToken, User


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class SessionApiTests(TestCase):
    login_url = '/api/auth/login'
    refresh_url = '/api/auth/refresh'
    logout_url = '/api/auth/logout'
    me_url = '/api/auth/me'

    def setUp(self):
        cache.clear()
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
        return response

    def test_login_returns_access_token_user_and_refresh_cookie(self):
        response = self._login()

        self.assertIn('access_token', response.data)
        self.assertEqual(response.data['user']['email'], 'owner@example.com')
        self.assertTrue(response.cookies['refresh']['httponly'])
        self.assertEqual(RefreshToken.objects.filter(user=self.user).count(), 1)

    def test_login_rejects_unconfirmed_user(self):
        self.user.is_confirmed = False
        self.user.save(update_fields=('is_confirmed', 'updated_at'))

        response = self.client.post(
            self.login_url,
            {'email': 'owner@example.com', 'password': 'StrongPass1'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_login_blocks_tenth_failed_attempt_for_ip_or_email(self):
        for attempt in range(1, 11):
            response = self.client.post(
                self.login_url,
                {'email': 'owner@example.com', 'password': 'WrongPass1'},
                format='json',
            )
            expected_status = (
                status.HTTP_429_TOO_MANY_REQUESTS
                if attempt == 10
                else status.HTTP_401_UNAUTHORIZED
            )
            self.assertEqual(response.status_code, expected_status)

        self.assertEqual(response['Retry-After'], '900')

    def test_refresh_rotates_token_and_revokes_previous_one(self):
        login_response = self._login()
        old_refresh = login_response.cookies['refresh'].value
        old_hash = hashlib.sha256(old_refresh.encode()).hexdigest()

        response = self.client.post(self.refresh_url, {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access_token', response.data)
        new_refresh = response.cookies['refresh'].value
        self.assertNotEqual(new_refresh, old_refresh)
        old_token = RefreshToken.objects.get(token_hash=old_hash)
        self.assertTrue(old_token.revoked)
        self.assertIsNotNone(old_token.replaced_by)

    def test_rotated_refresh_token_cannot_be_reused(self):
        login_response = self._login()
        old_refresh = login_response.cookies['refresh'].value
        self.client.post(self.refresh_url, {}, format='json')
        self.client.cookies['refresh'] = old_refresh

        response = self.client.post(self.refresh_url, {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_requires_cookie(self):
        response = self.client.post(self.refresh_url, {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_revokes_refresh_token_and_deletes_cookie(self):
        login_response = self._login()
        refresh_value = login_response.cookies['refresh'].value
        token_hash = hashlib.sha256(refresh_value.encode()).hexdigest()

        response = self.client.post(self.logout_url, {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(RefreshToken.objects.get(token_hash=token_hash).revoked)
        self.assertEqual(response.cookies['refresh']['max-age'], 0)

    def test_me_uses_bearer_access_token(self):
        login_response = self._login()
        access_token = login_response.data['access_token']

        response = self.client.get(
            self.me_url,
            HTTP_AUTHORIZATION=f'Bearer {access_token}',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['id'], str(self.user.id))
        self.assertEqual(response.data['workspace_id'], str(self.user.workspace_id))

    def test_me_rejects_anonymous_request(self):
        response = self.client.get(self.me_url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
