from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import update_last_login
from django.db import IntegrityError
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .serializers import (
    ForgotPasswordSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetSerializer,
    RegistrationConfirmSerializer,
    RegistrationRequestSerializer,
    RegistrationUserSerializer,
    UserSerializer,
)
from .services import (
    LOGIN_FAILURE_WINDOW_SECONDS,
    AuthServiceError,
    PasswordResetServiceError,
    RegistrationServiceError,
    clear_login_failures,
    confirm_password_reset_code,
    confirm_registration,
    issue_token_pair,
    login_is_blocked,
    logout_session,
    record_failed_login,
    reset_password,
    refresh_session,
    start_password_reset,
    start_registration,
)


User = get_user_model()


def _refresh_cookie_name():
    return getattr(settings, 'REST_AUTH', {}).get(
        'JWT_AUTH_REFRESH_COOKIE',
        'refresh',
    )


def _set_refresh_cookie(response, refresh_token, refresh_expires_at):
    rest_auth = getattr(settings, 'REST_AUTH', {})
    max_age = max(
        0,
        int((refresh_expires_at - timezone.now()).total_seconds()),
    )
    response.set_cookie(
        key=_refresh_cookie_name(),
        value=refresh_token,
        max_age=max_age,
        httponly=True,
        secure=rest_auth.get('JWT_AUTH_SECURE', True),
        samesite=rest_auth.get('JWT_AUTH_SAMESITE', 'Lax'),
        path='/',
    )


def _delete_refresh_cookie(response):
    response.delete_cookie(
        key=_refresh_cookie_name(),
        path='/',
        samesite=getattr(settings, 'REST_AUTH', {}).get(
            'JWT_AUTH_SAMESITE',
            'Lax',
        ),
    )


def _too_many_login_attempts_response():
    response = Response(
        {
            'detail': (
                'Слишком много неудачных попыток входа. '
                'Попробуйте через 15 минут.'
            ),
        },
        status=status.HTTP_429_TOO_MANY_REQUESTS,
    )
    response['Retry-After'] = str(LOGIN_FAILURE_WINDOW_SECONDS)
    return response


class RegisterView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration'

    def post(self, request):
        serializer = RegistrationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            email = start_registration(**serializer.validated_data)
        except RegistrationServiceError as error:
            return Response(error.response_data, status=error.status_code)

        return Response(
            {
                'message': 'Код подтверждения отправлен на e-mail',
                'email': email,
            },
            status=status.HTTP_200_OK,
        )


class ConfirmRegistrationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'registration_confirm'

    def post(self, request):
        serializer = RegistrationConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user, access_token, refresh_token, refresh_expires_at = (
                confirm_registration(**serializer.validated_data)
            )
        except RegistrationServiceError as error:
            return Response(error.response_data, status=error.status_code)
        except IntegrityError:
            return Response(
                {'email': ['Пользователь с таким e-mail уже существует.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        response = Response(
            {
                'message': 'Регистрация завершена',
                'access_token': access_token,
                'user': RegistrationUserSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )
        _set_refresh_cookie(response, refresh_token, refresh_expires_at)
        return response


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email']
        password = serializer.validated_data['password']
        ip_address = request.META.get('REMOTE_ADDR', '')

        if login_is_blocked(ip_address, email):
            return _too_many_login_attempts_response()

        user = User.objects.filter(email__iexact=email).first()
        if user is None or not user.is_active or not user.check_password(password):
            if record_failed_login(ip_address, email):
                return _too_many_login_attempts_response()
            return Response(
                {'detail': 'Неверный e-mail или пароль.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not user.is_confirmed:
            return Response(
                {'detail': 'E-mail не подтверждён.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        clear_login_failures(ip_address, email)
        update_last_login(None, user)
        access_token, refresh_token, refresh_expires_at, _ = issue_token_pair(user)
        response = Response(
            {
                'access_token': access_token,
                'user': RegistrationUserSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )
        _set_refresh_cookie(response, refresh_token, refresh_expires_at)
        return response


class RefreshSessionView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        refresh_value = request.COOKIES.get(_refresh_cookie_name())
        try:
            access_token, refresh_token, refresh_expires_at = refresh_session(
                refresh_value,
            )
        except AuthServiceError as error:
            response = Response(error.response_data, status=error.status_code)
            _delete_refresh_cookie(response)
            return response

        response = Response(
            {'access_token': access_token},
            status=status.HTTP_200_OK,
        )
        _set_refresh_cookie(response, refresh_token, refresh_expires_at)
        return response


class LogoutView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        refresh_value = request.COOKIES.get(_refresh_cookie_name())
        try:
            logout_session(refresh_value)
        except AuthServiceError as error:
            response = Response(error.response_data, status=error.status_code)
            _delete_refresh_cookie(response)
            return response

        response = Response(
            {'message': 'Выход выполнен'},
            status=status.HTTP_200_OK,
        )
        _delete_refresh_cookie(response)
        return response


class ForgotPasswordView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'password_reset_request'

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            start_password_reset(**serializer.validated_data)
        except PasswordResetServiceError as error:
            return Response(error.response_data, status=error.status_code)

        return Response(
            {'message': 'Код восстановления отправлен на e-mail'},
            status=status.HTTP_200_OK,
        )


class ConfirmPasswordResetView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'password_reset_confirm'

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            confirm_password_reset_code(**serializer.validated_data)
        except PasswordResetServiceError as error:
            return Response(error.response_data, status=error.status_code)

        return Response(
            {'message': 'Код подтверждён'},
            status=status.HTTP_200_OK,
        )


class ResetPasswordView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            reset_password(**serializer.validated_data)
        except PasswordResetServiceError as error:
            return Response(error.response_data, status=error.status_code)

        return Response(
            {'message': 'Пароль успешно изменён'},
            status=status.HTTP_200_OK,
        )


class MeView(generics.RetrieveAPIView):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user
