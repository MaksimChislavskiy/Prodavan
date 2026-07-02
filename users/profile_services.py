import hashlib
import ipaddress
import uuid
from datetime import timedelta
from io import BytesIO

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from .models import (
    DeletedEmailReservation,
    ProfileAuditAction,
    ProfileAuditLog,
    RefreshToken,
    User,
)


EMAIL_REUSE_DELAY = timedelta(days=30)
MAX_AVATAR_SIZE = 5 * 1024 * 1024
MIN_AVATAR_SIDE = 200
ALLOWED_AVATAR_FORMATS = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp'}


class ProfileServiceError(Exception):
    def __init__(self, message, *, status_code=400, field=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.field = field

    @property
    def response_data(self):
        if self.field:
            return {self.field: [self.message]}
        return {'detail': self.message}


class ProfileVersionConflict(ProfileServiceError):
    def __init__(self, current_version):
        super().__init__('version_conflict', status_code=409)
        self.current_version = current_version

    @property
    def response_data(self):
        return {
            'error': 'version_conflict',
            'current_version': self.current_version,
        }


def _request_metadata(request):
    raw_ip = request.META.get('REMOTE_ADDR') if request else None
    try:
        ip_address = str(ipaddress.ip_address(raw_ip)) if raw_ip else None
    except ValueError:
        ip_address = None
    user_agent = request.META.get('HTTP_USER_AGENT', '') if request else ''
    return ip_address, user_agent[:2000]


def _audit(user, action, request, changed_fields=None):
    ip_address, user_agent = _request_metadata(request)
    ProfileAuditLog.objects.create(
        user=user,
        user_identifier=user.id,
        action=action,
        changes={'fields': sorted(changed_fields or [])},
        ip_address=ip_address,
        user_agent=user_agent,
    )


def _active_profile_for_update(user_id):
    user = (
        User.objects.select_for_update()
        .filter(id=user_id, is_active=True, is_deleted=False)
        .first()
    )
    if user is None:
        raise ProfileServiceError('Профиль не найден.', status_code=404)
    return user


def update_profile(*, user_id, data, request):
    submitted_version = data['version']
    field_map = {
        'name': 'first_name',
        'position': 'position',
        'phone': 'phone_number',
        'email': 'email',
    }

    with transaction.atomic():
        user = _active_profile_for_update(user_id)
        if user.version != submitted_version:
            raise ProfileVersionConflict(user.version)

        new_email = data.get('email')
        if new_email is not None and new_email != user.email:
            email_hash = hashlib.sha256(new_email.encode()).hexdigest()
            reservation = DeletedEmailReservation.objects.filter(
                email_hash=email_hash,
                release_at__gt=timezone.now(),
            ).exists()
            email_used = (
                User.objects.filter(email__iexact=new_email)
                .exclude(id=user.id)
                .exists()
            )
            if reservation or email_used:
                raise ProfileServiceError(
                    'Этот email уже зарегистрирован.',
                    field='email',
                )

        changed_fields = []
        update_fields = []
        for api_field, model_field in field_map.items():
            if api_field not in data:
                continue
            value = data[api_field]
            if getattr(user, model_field) == value:
                continue
            setattr(user, model_field, value)
            changed_fields.append(api_field)
            update_fields.append(model_field)

        if changed_fields:
            user.version += 1
            update_fields.extend(('version', 'updated_at'))
            user.save(update_fields=update_fields)
            _audit(
                user,
                ProfileAuditAction.PROFILE_UPDATED,
                request,
                changed_fields,
            )

    return user


def _validated_avatar(uploaded_file):
    if uploaded_file.size > MAX_AVATAR_SIZE:
        raise ProfileServiceError(
            'Размер файла не должен превышать 5 МБ.',
            status_code=413,
            field='avatar',
        )

    try:
        uploaded_file.seek(0)
        probe = Image.open(uploaded_file)
        image_format = probe.format
        probe.verify()
        uploaded_file.seek(0)
        image = Image.open(uploaded_file)
        image.load()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ProfileServiceError(
            'Недопустимый формат файла или файл повреждён.',
            field='avatar',
        ) from error

    if image_format not in ALLOWED_AVATAR_FORMATS:
        raise ProfileServiceError(
            'Недопустимый формат файла или файл повреждён.',
            field='avatar',
        )
    if image.width < MIN_AVATAR_SIDE or image.height < MIN_AVATAR_SIDE:
        raise ProfileServiceError(
            'Изображение слишком маленькое. Минимум 200×200 пикселей.',
            field='avatar',
        )

    side = min(image.width, image.height)
    square = ImageOps.fit(
        image,
        (side, side),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    return square, image_format, ALLOWED_AVATAR_FORMATS[image_format]


def _encode_image(image, image_format):
    output = BytesIO()
    prepared = image
    options = {}
    if image_format == 'JPEG':
        if prepared.mode != 'RGB':
            prepared = prepared.convert('RGB')
        options = {'quality': 90, 'optimize': True}
    elif image_format == 'PNG':
        options = {'optimize': True}
    elif image_format == 'WEBP':
        options = {'quality': 90, 'method': 6}
    prepared.save(output, format=image_format, **options)
    return output.getvalue()


def _field_files(user):
    return [user.avatar, user.avatar_small, user.avatar_medium]


def _file_references(fields):
    return [
        (field.storage, field.name)
        for field in fields
        if field and field.name
    ]


def _delete_file_references(references):
    for storage, name in references:
        if storage.exists(name):
            storage.delete(name)


def upload_avatar(*, user_id, uploaded_file, request):
    square, image_format, extension = _validated_avatar(uploaded_file)
    image_versions = {
        'avatar': square,
        'avatar_small': square.resize((40, 40), Image.Resampling.LANCZOS),
        'avatar_medium': square.resize((160, 160), Image.Resampling.LANCZOS),
    }
    unique_name = uuid.uuid4().hex
    old_references = []
    new_references = []

    try:
        with transaction.atomic():
            user = _active_profile_for_update(user_id)
            old_references = _file_references(_field_files(user))
            for field_name, image in image_versions.items():
                field = getattr(user, field_name)
                field.save(
                    f'{user.id}/{unique_name}.{extension}',
                    ContentFile(_encode_image(image, image_format)),
                    save=False,
                )
                new_references.extend(_file_references([field]))
            user.version += 1
            user.save(
                update_fields=(
                    'avatar', 'avatar_small', 'avatar_medium',
                    'version', 'updated_at',
                ),
            )
            _audit(
                user,
                ProfileAuditAction.AVATAR_UPLOADED,
                request,
                ['avatar'],
            )
    except Exception:
        _delete_file_references(new_references)
        raise

    _delete_file_references(old_references)
    return user


def delete_avatar(*, user_id, request):
    with transaction.atomic():
        user = _active_profile_for_update(user_id)
        old_references = _file_references(_field_files(user))
        user.avatar = None
        user.avatar_small = None
        user.avatar_medium = None
        user.version += 1
        user.save(
            update_fields=(
                'avatar', 'avatar_small', 'avatar_medium',
                'version', 'updated_at',
            ),
        )
        _audit(
            user,
            ProfileAuditAction.AVATAR_DELETED,
            request,
            ['avatar'],
        )
    _delete_file_references(old_references)


def change_password(*, user_id, current_password, new_password, request):
    with transaction.atomic():
        user = _active_profile_for_update(user_id)
        if not user.check_password(current_password):
            raise ProfileServiceError(
                'Текущий пароль указан неверно.',
                field='current_password',
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
        _audit(
            user,
            ProfileAuditAction.PASSWORD_CHANGED,
            request,
            ['password'],
        )


def delete_profile(*, user_id, version, request):
    with transaction.atomic():
        user = _active_profile_for_update(user_id)
        if user.version != version:
            raise ProfileVersionConflict(user.version)

        now = timezone.now()
        old_references = _file_references(_field_files(user))
        original_email = user.email.lower()
        DeletedEmailReservation.objects.update_or_create(
            email_hash=hashlib.sha256(original_email.encode()).hexdigest(),
            defaults={
                'user_identifier': user.id,
                'deleted_at': now,
                'release_at': now + EMAIL_REUSE_DELAY,
            },
        )

        user.email = f'deleted-{user.id}@invalid.local'
        user.first_name = 'Удалённый'
        user.last_name = 'Пользователь'
        user.position = ''
        user.phone_number = ''
        user.avatar = None
        user.avatar_small = None
        user.avatar_medium = None
        user.is_active = False
        user.is_deleted = True
        user.deleted_at = now
        user.token_version += 1
        user.version += 1
        user.set_unusable_password()
        user.save(
            update_fields=(
                'email', 'first_name', 'last_name', 'position', 'phone_number',
                'avatar', 'avatar_small', 'avatar_medium', 'is_active',
                'is_deleted', 'deleted_at', 'token_version', 'version',
                'password', 'updated_at',
            ),
        )
        RefreshToken.objects.filter(user=user, revoked=False).update(
            revoked=True,
            revoked_at=now,
            updated_at=now,
        )
        _audit(
            user,
            ProfileAuditAction.ACCOUNT_DELETED,
            request,
            ['account'],
        )

    _delete_file_references(old_references)
