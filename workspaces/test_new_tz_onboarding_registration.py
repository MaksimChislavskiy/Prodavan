from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.test import TestCase, override_settings
from django.utils import timezone

from users.models import RegistrationToken
from users.services import confirm_registration

from .models import WorkspaceOnboarding


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class NewTzOnboardingRegistrationTests(TestCase):
    def test_confirm_registration_creates_not_started_onboarding_state(self):
        code = '4321'
        registration = RegistrationToken.objects.create(
            email='new-onboarding@example.com',
            name='Иван',
            surname='Иванов',
            password_hash=make_password('StrongPass1'),
            confirmation_code_hash=make_password(code),
            code_expires_at=timezone.now() + timedelta(minutes=10),
        )

        user, _, _, _ = confirm_registration(
            email=registration.email,
            code=code,
        )

        onboarding = WorkspaceOnboarding.objects.get(workspace=user.workspace)
        self.assertFalse(onboarding.completed)
        self.assertIsNone(onboarding.completed_at)
        self.assertFalse(onboarding.materials_viewed)
