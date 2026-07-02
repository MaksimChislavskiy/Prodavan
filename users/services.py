import hashlib
import secrets
from datetime import datetime, timedelta, timezone as datetime_timezone

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken as JWTRefreshToken

from workspaces.models import Workspace

from .models import (
    DeletedEmailReservation,
    PasswordResetToken,
    RefreshToken,
    RegistrationToken,
    User,
    UserRole,
)


REGISTRATION_CODE_TTL = timedelta(minutes=10)
PASSWORD_RESET_CODE_TTL = timedelta(minutes=10)
EMAIL_REUSE_DELAY = timedelta(days=30)
LOGIN_FAILURE_LIMIT = 10
LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60
PASSWORD_RESET_REQUEST_LIMIT = 5
PASSWORD_RESET_REQUEST_WINDOW_SECONDS = 60 * 60


class AuthServiceError(Exception):
    def __init__(self, message, *, status_code=401, field=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.field = field

    @property
    def response_data(self):
        if self.field:
            return {self.field: [self.message]}
        return {'detail': self.message}


class RegistrationServiceError(AuthServiceError):
    def __init__(self, message, *, status_code=400, field=None):
        super().__init__(message, status_code=status_code, field=field)


class PasswordResetServiceError(AuthServiceError):
    def __init__(self, message, *, status_code=400, field=None):
        super().__init__(message, status_code=status_code, field=field)


def _release_or_reject_existing_user(email):
    email_hash = hashlib.sha256(email.lower().encode()).hexdigest()
    reservation = (
        DeletedEmailReservation.objects.select_for_update()
        .filter(email_hash=email_hash)
        .first()
    )
    if reservation is not None:
        if reservation.release_at > timezone.now():
            raise RegistrationServiceError(
                'Этот e-mail временно недоступен для повторной регистрации.',
                field='email',
            )
        reservation.delete()

    user = User.objects.select_for_update().filter(email__iexact=email).first()
    if user is None:
        return

    if user.is_active or user.deleted_at is None:
        raise RegistrationServiceError(
            'Пользователь с таким e-mail уже существует.',
            field='email',
        )

    if user.deleted_at > timezone.now() - EMAIL_REUSE_DELAY:
        raise RegistrationServiceError(
            'Этот e-mail временно недоступен для повторной регистрации.',
            field='email',
        )

    user.email = f'deleted-{user.id}@invalid.local'
    user.save(update_fields=('email', 'updated_at'))


def issue_token_pair(user):
    jwt_refresh = JWTRefreshToken.for_user(user)
    jwt_refresh['token_version'] = user.token_version
    refresh_value = str(jwt_refresh)
    access_value = str(jwt_refresh.access_token)
    refresh_expires_at = datetime.fromtimestamp(
        jwt_refresh['exp'],
        tz=datetime_timezone.utc,
    )
    stored_token = RefreshToken.objects.create(
        user=user,
        token_hash=hashlib.sha256(refresh_value.encode()).hexdigest(),
        expires_at=refresh_expires_at,
    )
    return access_value, refresh_value, refresh_expires_at, stored_token


def _validated_stored_refresh(refresh_value, *, for_update=False):
    if not refresh_value:
        raise AuthServiceError('Refresh token отсутствует.')

    try:
        jwt_refresh = JWTRefreshToken(refresh_value)
    except TokenError as error:
        raise AuthServiceError('Refresh token недействителен или истёк.') from error

    queryset = RefreshToken.objects.select_related('user')
    if for_update:
        queryset = queryset.select_for_update()
    stored_token = queryset.filter(
        token_hash=hashlib.sha256(refresh_value.encode()).hexdigest(),
    ).first()
    if stored_token is None or not stored_token.is_valid:
        raise AuthServiceError('Refresh token недействителен или отозван.')
    if str(jwt_refresh['user_id']) != str(stored_token.user_id):
        raise AuthServiceError('Refresh token недействителен.')
    if jwt_refresh.payload.get('token_version') != stored_token.user.token_version:
        raise AuthServiceError('Сессия пользователя недействительна.')
    return stored_token


def refresh_session(refresh_value):
    with transaction.atomic():
        old_token = _validated_stored_refresh(refresh_value, for_update=True)
        user = old_token.user
        if not user.is_active or not user.is_confirmed:
            raise AuthServiceError('Сессия пользователя недействительна.')

        old_token.revoked = True
        old_token.revoked_at = timezone.now()
        old_token.save(update_fields=('revoked', 'revoked_at', 'updated_at'))
        access_value, new_refresh_value, expires_at, new_token = issue_token_pair(user)
        old_token.replaced_by = new_token
        old_token.save(update_fields=('replaced_by', 'updated_at'))

    return access_value, new_refresh_value, expires_at


def logout_session(refresh_value):
    with transaction.atomic():
        stored_token = _validated_stored_refresh(refresh_value, for_update=True)
        stored_token.revoked = True
        stored_token.revoked_at = timezone.now()
        stored_token.save(update_fields=('revoked', 'revoked_at', 'updated_at'))


def _login_failure_keys(ip_address, email):
    email_hash = hashlib.sha256(email.encode()).hexdigest()
    ip_hash = hashlib.sha256((ip_address or 'unknown').encode()).hexdigest()
    return (
        f'auth:login-fail:email:{email_hash}',
        f'auth:login-fail:ip:{ip_hash}',
    )


def login_is_blocked(ip_address, email):
    return any(
        int(cache.get(key, 0)) >= LOGIN_FAILURE_LIMIT
        for key in _login_failure_keys(ip_address, email)
    )


def record_failed_login(ip_address, email):
    counts = []
    for key in _login_failure_keys(ip_address, email):
        if cache.add(key, 1, timeout=LOGIN_FAILURE_WINDOW_SECONDS):
            count = 1
        else:
            try:
                count = cache.incr(key)
            except ValueError:
                cache.set(key, 1, timeout=LOGIN_FAILURE_WINDOW_SECONDS)
                count = 1
        counts.append(count)
    return max(counts) >= LOGIN_FAILURE_LIMIT


def clear_login_failures(ip_address, email):
    cache.delete_many(_login_failure_keys(ip_address, email))


def _password_reset_request_key(email):
    email_hash = hashlib.sha256(email.encode()).hexdigest()
    return f'auth:password-reset:email:{email_hash}'


def password_reset_request_is_blocked(email):
    return int(cache.get(_password_reset_request_key(email), 0)) >= (
        PASSWORD_RESET_REQUEST_LIMIT
    )


def _record_password_reset_request(email):
    key = _password_reset_request_key(email)
    if cache.add(key, 1, timeout=PASSWORD_RESET_REQUEST_WINDOW_SECONDS):
        return
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=PASSWORD_RESET_REQUEST_WINDOW_SECONDS)


def start_password_reset(*, email):
    if password_reset_request_is_blocked(email):
        raise PasswordResetServiceError(
            'Слишком много запросов. Попробуйте позже.',
            status_code=429,
        )

    code = str(secrets.randbelow(9000) + 1000)
    with transaction.atomic():
        user = (
            User.objects.select_for_update()
            .filter(email__iexact=email, is_active=True, is_confirmed=True)
            .first()
        )
        if user is None:
            raise PasswordResetServiceError(
                'Пользователь с таким e-mail не найден.',
                status_code=404,
                field='email',
            )

        now = timezone.now()
        PasswordResetToken.objects.filter(user=user, used=False).update(
            used=True,
            updated_at=now,
        )
        PasswordResetToken.objects.create(
            user=user,
            reset_code_hash=make_password(code),
            code_expires_at=now + PASSWORD_RESET_CODE_TTL,
        )
        send_mail(
            subject='Код восстановления пароля в «Продаван»',
            message=(
                f'Ваш код восстановления: {code}\n\n'
                'Код действует 10 минут. Если вы не запрашивали восстановление, '
                'просто проигнорируйте это письмо.'
            ),
            from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
            recipient_list=[email],
            fail_silently=False,
        )

    _record_password_reset_request(email)


def confirm_password_reset_code(*, email, code):
    deferred_error = None

    with transaction.atomic():
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user is None:
            deferred_error = PasswordResetServiceError(
                'Пользователь с таким e-mail не найден.',
                status_code=404,
                field='email',
            )
            token = None
        else:
            token = (
                PasswordResetToken.objects.select_for_update()
                .filter(user=user, used=False)
                .order_by('-created_at')
                .first()
            )

        if deferred_error is None and token is None:
            deferred_error = PasswordResetServiceError(
                'Код восстановления не найден.',
                status_code=404,
            )
        elif token is not None and token.is_expired:
            deferred_error = PasswordResetServiceError(
                'Срок действия кода истёк. Запросите новый код.',
            )
        elif token is not None and token.attempts >= token.MAX_ATTEMPTS:
            deferred_error = PasswordResetServiceError(
                'Превышено количество попыток. Запросите новый код.',
            )
        elif token is not None and not check_password(code, token.reset_code_hash):
            token.attempts += 1
            token.save(update_fields=('attempts', 'updated_at'))
            if token.attempts >= token.MAX_ATTEMPTS:
                deferred_error = PasswordResetServiceError(
                    'Превышено количество попыток. Запросите новый код.',
                )
            else:
                deferred_error = PasswordResetServiceError(
                    'Неверный код подтверждения.',
                )
        elif token is not None:
            token.confirmed_at = timezone.now()
            token.save(update_fields=('confirmed_at', 'updated_at'))

    if deferred_error is not None:
        raise deferred_error


def reset_password(*, email, new_password):
    with transaction.atomic():
        user = (
            User.objects.select_for_update()
            .filter(email__iexact=email, is_active=True, is_confirmed=True)
            .first()
        )
        if user is None:
            raise PasswordResetServiceError(
                'Пользователь с таким e-mail не найден.',
                field='email',
            )

        token = (
            PasswordResetToken.objects.select_for_update()
            .filter(user=user, used=False)
            .order_by('-created_at')
            .first()
        )
        if token is None or token.confirmed_at is None:
            raise PasswordResetServiceError('Код восстановления не подтверждён.')
        if token.is_expired:
            raise PasswordResetServiceError(
                'Срок действия кода истёк. Запросите новый код.',
            )

        now = timezone.now()
        user.set_password(new_password)
        user.token_version += 1
        user.save(update_fields=('password', 'token_version', 'updated_at'))
        RefreshToken.objects.filter(user=user, revoked=False).update(
            revoked=True,
            revoked_at=now,
            updated_at=now,
        )
        token.used = True
        token.save(update_fields=('used', 'updated_at'))


def start_registration(*, name, surname, email, password):
    code = str(secrets.randbelow(9000) + 1000)

    with transaction.atomic():
        _release_or_reject_existing_user(email)
        RegistrationToken.objects.update_or_create(
            email=email,
            defaults={
                'name': name,
                'surname': surname,
                'password_hash': make_password(password),
                'confirmation_code_hash': make_password(code),
                'code_expires_at': timezone.now() + REGISTRATION_CODE_TTL,
                'attempts': 0,
                'expired': False,
            },
        )
        send_mail(
            subject='Код подтверждения регистрации в «Продаван»',
            message=(
                f'Ваш код подтверждения: {code}\n\n'
                'Код действует 10 минут. Если вы не регистрировались, '
                'просто проигнорируйте это письмо.'
            ),
            from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
            recipient_list=[email],
            fail_silently=False,
        )

    return email


def confirm_registration(*, email, code):
    deferred_error = None
    result = None

    with transaction.atomic():
        registration = (
            RegistrationToken.objects.select_for_update()
            .filter(email=email)
            .first()
        )
        if registration is None:
            deferred_error = RegistrationServiceError(
                'Временная регистрационная запись не найдена.',
                status_code=404,
            )
        elif registration.is_expired:
            if not registration.expired:
                registration.expired = True
                registration.save(update_fields=('expired', 'updated_at'))
            deferred_error = RegistrationServiceError(
                'Срок действия кода истёк. Запросите новый код.',
            )
        elif registration.attempts >= registration.MAX_ATTEMPTS:
            deferred_error = RegistrationServiceError(
                'Превышено количество попыток. Запросите новый код.',
            )
        elif not check_password(code, registration.confirmation_code_hash):
            registration.attempts += 1
            registration.save(update_fields=('attempts', 'updated_at'))
            if registration.attempts >= registration.MAX_ATTEMPTS:
                deferred_error = RegistrationServiceError(
                    'Превышено количество попыток. Запросите новый код.',
                )
            else:
                deferred_error = RegistrationServiceError(
                    'Неверный код подтверждения.',
                )
        else:
            _release_or_reject_existing_user(email)
            workspace = Workspace.objects.create(
                name=f'Компания {registration.name} {registration.surname}'[:255],
            )
            user = User(
                email=email,
                first_name=registration.name,
                last_name=registration.surname,
                workspace=workspace,
                role=UserRole.ADMIN,
                is_active=True,
                is_confirmed=True,
                password=registration.password_hash,
            )
            user.save(force_insert=True)
            access_value, refresh_value, refresh_expires_at, _ = issue_token_pair(user)
            registration.delete()
            result = user, access_value, refresh_value, refresh_expires_at

    if deferred_error is not None:
        raise deferred_error
    return result
