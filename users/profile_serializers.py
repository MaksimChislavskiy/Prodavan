import re

from rest_framework import serializers

from .models import User
from .serializers import validate_secure_password


PROFILE_TEXT_PATTERN = re.compile(r'^[A-Za-zА-Яа-яЁё -]+$')
PHONE_PATTERN = re.compile(r'^[0-9+()\- ]+$')


def _versioned_file_url(request, field, version):
    if not field:
        return None
    url = field.url
    separator = '&' if '?' in url else '?'
    url = f'{url}{separator}v={version}'
    return request.build_absolute_uri(url) if request else url


class ProfileSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='first_name')
    phone = serializers.CharField(source='phone_number')
    avatar = serializers.SerializerMethodField()
    avatar_small = serializers.SerializerMethodField()
    avatar_medium = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'name', 'position', 'phone', 'email', 'avatar',
            'avatar_small', 'avatar_medium', 'version',
        )

    def get_avatar(self, obj):
        return _versioned_file_url(
            self.context.get('request'),
            obj.avatar,
            obj.version,
        )

    def get_avatar_small(self, obj):
        return _versioned_file_url(
            self.context.get('request'),
            obj.avatar_small,
            obj.version,
        )

    def get_avatar_medium(self, obj):
        return _versioned_file_url(
            self.context.get('request'),
            obj.avatar_medium,
            obj.version,
        )


class ProfileUpdateSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=0)
    name = serializers.CharField(
        min_length=2,
        max_length=100,
        required=False,
        allow_blank=False,
    )
    position = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
    )
    phone = serializers.CharField(
        max_length=20,
        required=False,
        allow_blank=True,
    )
    email = serializers.EmailField(max_length=255, required=False)

    def validate_name(self, value):
        value = value.strip()
        if not PROFILE_TEXT_PATTERN.fullmatch(value):
            raise serializers.ValidationError(
                'Допустимы только кириллица, латиница, пробел и дефис.',
            )
        return value

    def validate_position(self, value):
        value = value.strip()
        if value and not PROFILE_TEXT_PATTERN.fullmatch(value):
            raise serializers.ValidationError(
                'Допустимы только кириллица, латиница, пробел и дефис.',
            )
        return value

    def validate_phone(self, value):
        value = value.strip()
        if not value:
            return value
        if not PHONE_PATTERN.fullmatch(value):
            raise serializers.ValidationError('Укажите корректный номер телефона.')
        if sum(character.isdigit() for character in value) < 5:
            raise serializers.ValidationError(
                'Телефон должен содержать минимум 5 цифр.',
            )
        return value

    def validate_email(self, value):
        return value.strip().lower()


class ProfileDeleteSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=0)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(
        max_length=128,
        trim_whitespace=False,
        write_only=True,
    )
    new_password = serializers.CharField(
        min_length=8,
        max_length=128,
        trim_whitespace=False,
        write_only=True,
        validators=[validate_secure_password],
    )
