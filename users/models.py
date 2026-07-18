import uuid

from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

from config.mixins import TimestampMixin


class UserRole(models.TextChoices):
    ADMIN = 'admin', 'Администратор'
    USER = 'user', 'Пользователь'


class ProfileAuditAction(models.TextChoices):
    PROFILE_UPDATED = 'profile_updated', 'Изменение профиля'
    AVATAR_UPLOADED = 'avatar_uploaded', 'Загрузка аватара'
    AVATAR_DELETED = 'avatar_deleted', 'Удаление аватара'
    PASSWORD_CHANGED = 'password_changed', 'Смена пароля'
    ACCOUNT_DELETED = 'account_deleted', 'Удаление аккаунта'


class AuthAuditAction(models.TextChoices):
    REGISTRATION_REQUESTED = 'registration_requested', 'Запрос регистрации'
    REGISTRATION_CONFIRMED = 'registration_confirmed', 'Регистрация подтверждена'
    LOGIN = 'login', 'Вход'
    PASSWORD_RESET_REQUESTED = (
        'password_reset_requested',
        'Запрос восстановления пароля',
    )
    PASSWORD_RESET_CODE_CONFIRMED = (
        'password_reset_code_confirmed',
        'Код восстановления подтверждён',
    )
    PASSWORD_RESET_COMPLETED = (
        'password_reset_completed',
        'Пароль восстановлен',
    )


class AuthEmailPurpose(models.TextChoices):
    REGISTRATION = 'registration', 'Подтверждение регистрации'
    PASSWORD_RESET = 'password_reset', 'Восстановление пароля'


class AuthEmailDeliveryStatus(models.TextChoices):
    PENDING = 'pending', 'Ожидает отправки'
    SENT = 'sent', 'Отправлено'
    FAILED = 'failed', 'Ошибка'
    CANCELLED = 'cancelled', 'Отменено'
    EXPIRED = 'expired', 'Истекло'


class TariffChoices(models.TextChoices):
    FREE = 'free', 'Бесплатный'
    PRO = 'pro', 'Профессиональный'
    BUSINESS = 'business', 'Бизнес'


class UserManager(BaseUserManager):
    use_in_migrations = True

    @staticmethod
    def normalize_email(email):
        return super(UserManager, UserManager).normalize_email(email).strip().lower()

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('E-mail обязателен.')

        email = self.normalize_email(email)
        workspace = extra_fields.get('workspace')
        if workspace is None:
            from workspaces.models import Workspace

            first_name = extra_fields.get('first_name', '').strip()
            last_name = extra_fields.get('last_name', '').strip()
            owner_name = ' '.join(part for part in (first_name, last_name) if part)
            workspace = Workspace.objects.create(
                name=f'Компания {owner_name or email}'[:255],
            )
            extra_fields['workspace'] = workspace

        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_active', True)
        extra_fields.setdefault('is_confirmed', True)
        extra_fields.setdefault('role', UserRole.ADMIN)

        if extra_fields.get('is_staff') is not True:
            raise ValueError('Суперпользователь должен иметь is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Суперпользователь должен иметь is_superuser=True.')

        return self.create_user(email, password, **extra_fields)


class User(AbstractUser, TimestampMixin):
    username = None

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.PROTECT,
        related_name='users',
        verbose_name='Рабочее пространство',
    )
    email = models.EmailField(
        max_length=255,
        unique=True,
        verbose_name='Электронная почта',
    )
    first_name = models.CharField(max_length=100, verbose_name='Имя')
    last_name = models.CharField(max_length=50, verbose_name='Фамилия')
    position = models.CharField(
        max_length=100,
        blank=True,
        default='',
        verbose_name='Должность',
    )
    role = models.CharField(
        max_length=16,
        choices=UserRole.choices,
        default=UserRole.ADMIN,
        verbose_name='Роль',
    )
    is_confirmed = models.BooleanField(
        default=False,
        verbose_name='E-mail подтверждён',
    )
    is_deleted = models.BooleanField(default=False, verbose_name='Удалён')
    version = models.PositiveIntegerField(default=0, verbose_name='Версия профиля')
    token_version = models.PositiveIntegerField(
        default=0,
        verbose_name='Версия сессии',
    )
    deleted_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name='Дата удаления',
    )
    phone_number = models.CharField(
        max_length=20,
        blank=True,
        default='',
        verbose_name='Номер телефона',
    )
    avatar = models.ImageField(
        upload_to='avatars/original/',
        null=True,
        blank=True,
        default=None,
        verbose_name='Аватар',
    )
    avatar_small = models.ImageField(
        upload_to='avatars/40/',
        null=True,
        blank=True,
        default=None,
        verbose_name='Аватар 40×40',
    )
    avatar_medium = models.ImageField(
        upload_to='avatars/160/',
        null=True,
        blank=True,
        default=None,
        verbose_name='Аватар 160×160',
    )
    tariff = models.CharField(
        max_length=20,
        choices=TariffChoices.choices,
        default=TariffChoices.FREE,
        verbose_name='Тариф',
    )
    tariff_balance = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0.00,
        verbose_name='Остаток на тарифе',
    )

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['first_name', 'last_name']

    class Meta:
        db_table = 'users'
        verbose_name = 'Пользователь'
        verbose_name_plural = 'Пользователи'
        ordering = ('-created_at',)
        constraints = [
            models.UniqueConstraint(
                Lower('email'),
                name='users_email_ci_unique',
            ),
        ]

    def __str__(self):
        return self.email

    @property
    def full_name(self):
        return f'{self.first_name} {self.last_name}'.strip()

    def soft_delete(self):
        self.is_active = False
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.save(
            update_fields=(
                'is_active',
                'is_deleted',
                'deleted_at',
                'updated_at',
            ),
        )


class RegistrationToken(TimestampMixin):
    MAX_ATTEMPTS = 5

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(max_length=255, unique=True)
    name = models.CharField(max_length=50)
    surname = models.CharField(max_length=50)
    password_hash = models.CharField(max_length=128)
    confirmation_code_hash = models.CharField(max_length=128)
    code_expires_at = models.DateTimeField(db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    expired = models.BooleanField(default=False)

    class Meta:
        db_table = 'registration_tokens'
        ordering = ('-created_at',)

    @property
    def is_expired(self):
        return self.expired or self.code_expires_at <= timezone.now()

    @property
    def can_attempt(self):
        return not self.is_expired and self.attempts < self.MAX_ATTEMPTS


class PasswordResetToken(TimestampMixin):
    MAX_ATTEMPTS = 5

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='password_reset_tokens',
    )
    reset_code_hash = models.CharField(max_length=128)
    code_expires_at = models.DateTimeField(db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    used = models.BooleanField(default=False)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'password_reset_tokens'
        ordering = ('-created_at',)

    @property
    def is_expired(self):
        return self.code_expires_at <= timezone.now()

    @property
    def can_attempt(self):
        return not self.used and not self.is_expired and self.attempts < self.MAX_ATTEMPTS


class RefreshToken(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='refresh_tokens',
    )
    token_hash = models.CharField(max_length=128, unique=True)
    expires_at = models.DateTimeField(db_index=True)
    revoked = models.BooleanField(default=False, db_index=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    replaced_by = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='replaces',
    )

    class Meta:
        db_table = 'refresh_tokens'
        ordering = ('-created_at',)

    @property
    def is_valid(self):
        return not self.revoked and self.expires_at > timezone.now()


class DeletedEmailReservation(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email_hash = models.CharField(max_length=64, unique=True)
    user_identifier = models.UUIDField(db_index=True)
    deleted_at = models.DateTimeField()
    release_at = models.DateTimeField(db_index=True)

    class Meta:
        db_table = 'deleted_email_reservations'
        ordering = ('-deleted_at',)


class AuthEmailDelivery(TimestampMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient_hash = models.CharField(max_length=64, db_index=True)
    purpose = models.CharField(max_length=32, choices=AuthEmailPurpose.choices)
    encrypted_payload = models.JSONField()
    status = models.CharField(
        max_length=16,
        choices=AuthEmailDeliveryStatus.choices,
        default=AuthEmailDeliveryStatus.PENDING,
        db_index=True,
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True, db_index=True)
    expires_at = models.DateTimeField(db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=1000, blank=True, default='')

    class Meta:
        db_table = 'auth_email_deliveries'
        ordering = ('next_attempt_at', 'created_at')
        indexes = [
            models.Index(
                fields=('status', 'next_attempt_at'),
                name='auth_email_queue_idx',
            ),
            models.Index(
                fields=('recipient_hash', 'purpose', 'status'),
                name='auth_email_recipient_idx',
            ),
        ]


class AuthAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='auth_audit_logs',
    )
    user_identifier = models.UUIDField(null=True, blank=True, db_index=True)
    email_hash = models.CharField(max_length=64, db_index=True)
    action = models.CharField(
        max_length=40,
        choices=AuthAuditAction.choices,
        db_index=True,
    )
    successful = models.BooleanField(default=False, db_index=True)
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'auth_audit_logs'
        ordering = ('-created_at',)
        indexes = [
            models.Index(
                fields=('action', 'successful', '-created_at'),
                name='auth_audit_action_idx',
            ),
            models.Index(
                fields=('email_hash', '-created_at'),
                name='auth_audit_email_idx',
            ),
        ]


class ProfileAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='profile_audit_logs',
    )
    user_identifier = models.UUIDField(db_index=True)
    action = models.CharField(max_length=32, choices=ProfileAuditAction.choices)
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'profile_audit_logs'
        ordering = ('-created_at',)
