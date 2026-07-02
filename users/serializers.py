import re

from django.contrib.auth import get_user_model
from rest_framework import serializers


User = get_user_model()
NAME_PATTERN = re.compile(r'^[A-Za-zА-Яа-яЁё -]+$')


def validate_person_name(value):
    value = value.strip()
    if not 2 <= len(value) <= 50:
        raise serializers.ValidationError('Допустимая длина — от 2 до 50 символов.')
    if not NAME_PATTERN.fullmatch(value):
        raise serializers.ValidationError(
            'Допустимы только кириллица, латиница, пробел и дефис.',
        )
    return value


def validate_secure_password(value):
    has_digit_or_special = any(
        character.isdigit()
        or (not character.isalnum() and not character.isspace())
        for character in value
    )
    if not has_digit_or_special:
        raise serializers.ValidationError(
            'Пароль не соответствует требованиям безопасности.',
        )
    return value


class RegistrationRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=50, validators=[validate_person_name])
    surname = serializers.CharField(max_length=50, validators=[validate_person_name])
    email = serializers.EmailField(max_length=255)
    password = serializers.CharField(
        min_length=8,
        max_length=128,
        trim_whitespace=False,
        write_only=True,
    )

    def validate_email(self, value):
        return value.strip().lower()

    def validate_password(self, value):
        return validate_secure_password(value)


class RegistrationConfirmSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=255)
    code = serializers.RegexField(
        regex=r'^[1-9]\d{3}$',
        error_messages={'invalid': 'Код должен состоять из 4 цифр.'},
    )

    def validate_email(self, value):
        return value.strip().lower()


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=255)
    password = serializers.CharField(
        max_length=128,
        trim_whitespace=False,
        write_only=True,
    )

    def validate_email(self, value):
        return value.strip().lower()


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=255)

    def validate_email(self, value):
        return value.strip().lower()


class PasswordResetConfirmSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=255)
    code = serializers.RegexField(
        regex=r'^[1-9]\d{3}$',
        error_messages={'invalid': 'Код должен состоять из 4 цифр.'},
    )

    def validate_email(self, value):
        return value.strip().lower()


class PasswordResetSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=255)
    new_password = serializers.CharField(
        min_length=8,
        max_length=128,
        trim_whitespace=False,
        write_only=True,
        validators=[validate_secure_password],
    )

    def validate_email(self, value):
        return value.strip().lower()


class RegistrationUserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='first_name')
    surname = serializers.CharField(source='last_name')

    class Meta:
        model = User
        fields = ('id', 'name', 'surname', 'email', 'role')


class UserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='first_name')
    surname = serializers.CharField(source='last_name')
    workspace_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = User
        fields = ('id', 'name', 'surname', 'email', 'role', 'workspace_id')
        read_only_fields = ('id', 'email', 'role', 'workspace_id')


class UserUpdateSerializer(serializers.ModelSerializer):
    name = serializers.CharField(
        source='first_name',
        max_length=50,
        validators=[validate_person_name],
        required=False,
    )
    surname = serializers.CharField(
        source='last_name',
        max_length=50,
        validators=[validate_person_name],
        required=False,
    )

    class Meta:
        model = User
        fields = ('name', 'surname', 'phone_number', 'avatar')
