import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers

from .models import Workspace, WorkspaceIntegration


def _nullable_trimmed(value):
    if value is None:
        return None
    value = value.strip()
    return value or None


def _inn_is_valid(value):
    if not value.isdigit() or len(value) not in (10, 12):
        return False
    digits = [int(character) for character in value]
    if len(digits) == 10:
        weights = (2, 4, 10, 3, 5, 9, 4, 6, 8)
        return sum(a * b for a, b in zip(digits, weights)) % 11 % 10 == digits[9]
    weights_11 = (7, 2, 4, 10, 3, 5, 9, 4, 6, 8)
    weights_12 = (3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8)
    check_11 = sum(a * b for a, b in zip(digits, weights_11)) % 11 % 10
    check_12 = sum(a * b for a, b in zip(digits, weights_12)) % 11 % 10
    return check_11 == digits[10] and check_12 == digits[11]


def _ogrn_is_valid(value):
    if not value.isdigit() or len(value) not in (13, 15):
        return False
    divisor = 11 if len(value) == 13 else 13
    return int(value[:-1]) % divisor % 10 == int(value[-1])


class CompanySettingsSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255, required=False)
    short_name = serializers.CharField(
        max_length=255,
        required=False,
        allow_null=True,
        allow_blank=True,
    )
    legal_address = serializers.CharField(
        max_length=1000,
        required=False,
        allow_null=True,
        allow_blank=True,
    )
    postal_address = serializers.CharField(
        max_length=1000,
        required=False,
        allow_null=True,
        allow_blank=True,
    )
    inn = serializers.CharField(
        max_length=12,
        required=False,
        allow_null=True,
        allow_blank=True,
    )
    kpp = serializers.CharField(
        max_length=9,
        required=False,
        allow_null=True,
        allow_blank=True,
    )
    ogrn = serializers.CharField(
        max_length=15,
        required=False,
        allow_null=True,
        allow_blank=True,
    )
    okved = serializers.CharField(
        max_length=20,
        required=False,
        allow_null=True,
        allow_blank=True,
    )
    okpo = serializers.CharField(
        max_length=10,
        required=False,
        allow_null=True,
        allow_blank=True,
    )

    def to_internal_value(self, data):
        unknown_fields = set(data) - set(self.fields)
        if unknown_fields:
            raise serializers.ValidationError(
                f'Неизвестные поля: {", ".join(sorted(unknown_fields))}',
                code='VALIDATION_ERROR',
            )
        return super().to_internal_value(data)

    def validate_full_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(
                'Полное наименование не может быть пустым.',
                code='VALIDATION_ERROR',
            )
        return value

    def validate_short_name(self, value):
        return _nullable_trimmed(value)

    def validate_legal_address(self, value):
        return _nullable_trimmed(value)

    def validate_postal_address(self, value):
        return _nullable_trimmed(value)

    def validate_inn(self, value):
        value = _nullable_trimmed(value)
        if value is not None and not _inn_is_valid(value):
            raise serializers.ValidationError(
                'Некорректный ИНН',
                code='INVALID_INN',
            )
        return value

    def validate_kpp(self, value):
        value = _nullable_trimmed(value)
        if value is not None and not re.fullmatch(r'\d{9}', value):
            raise serializers.ValidationError(
                'Некорректный КПП',
                code='INVALID_KPP',
            )
        return value

    def validate_ogrn(self, value):
        value = _nullable_trimmed(value)
        if value is not None and not _ogrn_is_valid(value):
            raise serializers.ValidationError(
                'Некорректный ОГРН',
                code='INVALID_OGRN',
            )
        return value

    def validate_okved(self, value):
        value = _nullable_trimmed(value)
        if value is not None and not re.fullmatch(r'\d+(?:\.\d+)*', value):
            raise serializers.ValidationError(
                'Некорректный ОКВЭД',
                code='VALIDATION_ERROR',
            )
        return value

    def validate_okpo(self, value):
        value = _nullable_trimmed(value)
        if value is not None and not re.fullmatch(r'(?:\d{8}|\d{10})', value):
            raise serializers.ValidationError(
                'Некорректный ОКПО',
                code='VALIDATION_ERROR',
            )
        return value


class WorkspaceIntegrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkspaceIntegration
        fields = (
            'type', 'status', 'health_status', 'bot_username',
            'connected_at', 'last_check_at',
        )


class WorkspaceSettingsSerializer(serializers.ModelSerializer):
    company = CompanySettingsSerializer()
    integrations = WorkspaceIntegrationSerializer(many=True, read_only=True)

    class Meta:
        model = Workspace
        fields = ('version', 'timezone', 'language', 'company', 'integrations')


class WorkspaceSettingsUpdateSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=0)
    timezone = serializers.CharField(max_length=64, required=False)
    company = CompanySettingsSerializer(required=False)

    def to_internal_value(self, data):
        unknown_fields = set(data) - set(self.fields)
        if unknown_fields:
            raise serializers.ValidationError(
                f'Поля недоступны для изменения: '
                f'{", ".join(sorted(unknown_fields))}',
                code='VALIDATION_ERROR',
            )
        return super().to_internal_value(data)

    def validate_timezone(self, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise serializers.ValidationError(
                'Некорректный часовой пояс',
                code='INVALID_TIMEZONE',
            )
        if '/' not in value and value != 'UTC':
            raise serializers.ValidationError(
                'Некорректный часовой пояс',
                code='INVALID_TIMEZONE',
            )
        return value


class TelegramConnectSerializer(serializers.Serializer):
    bot_token = serializers.CharField(
        min_length=20,
        max_length=512,
        trim_whitespace=False,
        write_only=True,
    )

    def validate_bot_token(self, value):
        value = value.strip()
        if any(character.isspace() for character in value) or ':' not in value:
            raise serializers.ValidationError('Некорректный формат токена.')
        return value
