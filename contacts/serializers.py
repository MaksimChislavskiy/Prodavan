import re

from rest_framework import serializers

from .models import Contact


NAME_PATTERN = re.compile(r'^[A-Za-zА-Яа-яЁё\- ]+$')
EMAIL_PATTERN = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
TELEGRAM_PATTERN = re.compile(r'^[A-Za-z0-9_]{5,32}$')


def _nullable_trimmed(value):
    if value is None:
        return None
    value = value.strip()
    return value or None


def normalize_name(value):
    value = value.strip()
    if not value or not NAME_PATTERN.fullmatch(value):
        raise serializers.ValidationError(
            'ФИО должно содержать только буквы, пробелы и дефисы.',
        )
    return value


def normalize_phone(value):
    value = _nullable_trimmed(value)
    if value is None:
        return None
    value = re.sub(r'[\s()\-]', '', value)
    if value.startswith('+'):
        digits = value[1:]
        normalized = value
    elif value.isdigit() and len(value) == 11 and value.startswith('8'):
        digits = f'7{value[1:]}'
        normalized = f'+{digits}'
    elif value.isdigit() and len(value) == 10:
        digits = f'7{value}'
        normalized = f'+{digits}'
    else:
        digits = value
        normalized = value
    if not digits.isdigit() or not 7 <= len(digits) <= 15:
        raise serializers.ValidationError('Некорректный номер телефона.')
    return normalized


def normalize_email(value):
    value = _nullable_trimmed(value)
    if value is None:
        return None
    value = value.lower()
    if not EMAIL_PATTERN.fullmatch(value):
        raise serializers.ValidationError('Некорректный email.')
    return value


def normalize_telegram(value):
    value = _nullable_trimmed(value)
    if value is None:
        return None
    username = value.lstrip('@')
    if not TELEGRAM_PATTERN.fullmatch(username):
        raise serializers.ValidationError(
            'Никнейм Telegram должен содержать 5–32 латинских символа, '
            'цифры или _.',
        )
    return f'@{username}'


class ContactReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = (
            'id', 'name', 'company', 'phone', 'email', 'telegram',
            'comment', 'ai_insights', 'version', 'created_at', 'updated_at',
        )


class ContactAutocompleteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ('id', 'name', 'company', 'phone', 'email', 'telegram')


class ContactValidationMixin:
    def to_internal_value(self, data):
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {
                    field: 'Неизвестное поле.'
                    for field in sorted(unknown)
                },
            )
        return super().to_internal_value(data)

    def validate_name(self, value):
        return normalize_name(value)

    def validate_company(self, value):
        return _nullable_trimmed(value)

    def validate_phone(self, value):
        return normalize_phone(value)

    def validate_email(self, value):
        return normalize_email(value)

    def validate_telegram(self, value):
        return normalize_telegram(value)

    def validate_comment(self, value):
        return _nullable_trimmed(value)


class ContactCreateSerializer(ContactValidationMixin, serializers.Serializer):
    name = serializers.CharField(max_length=100)
    company = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    phone = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    email = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    telegram = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    comment = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        allow_null=True,
    )


class ContactUpdateSerializer(ContactValidationMixin, serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=100, required=False)
    company = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    phone = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    email = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    telegram = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    comment = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        allow_null=True,
    )


class ContactBulkDeleteSerializer(serializers.Serializer):
    contact_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=False,
    )

    def validate_contact_ids(self, value):
        unique_ids = list(dict.fromkeys(value))
        if len(unique_ids) > 100:
            raise serializers.ValidationError(
                'Можно удалить не более 100 контактов за раз.',
            )
        return unique_ids
