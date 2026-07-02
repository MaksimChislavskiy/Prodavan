from django.conf import settings
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .profile_serializers import (
    ChangePasswordSerializer,
    ProfileDeleteSerializer,
    ProfileSerializer,
    ProfileUpdateSerializer,
)
from .profile_services import (
    ProfileServiceError,
    change_password,
    delete_avatar,
    delete_profile,
    update_profile,
    upload_avatar,
)


def _delete_refresh_cookie(response):
    rest_auth = getattr(settings, 'REST_AUTH', {})
    response.delete_cookie(
        key=rest_auth.get('JWT_AUTH_REFRESH_COOKIE', 'refresh'),
        path='/',
        samesite=rest_auth.get('JWT_AUTH_SAMESITE', 'Lax'),
    )


def _error_response(error):
    return Response(error.response_data, status=error.status_code)


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            ProfileSerializer(
                request.user,
                context={'request': request},
            ).data,
            status=status.HTTP_200_OK,
        )

    def patch(self, request):
        serializer = ProfileUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = update_profile(
                user_id=request.user.id,
                data=serializer.validated_data,
                request=request,
            )
        except ProfileServiceError as error:
            return _error_response(error)

        return Response(
            ProfileSerializer(user, context={'request': request}).data,
            status=status.HTTP_200_OK,
        )

    def delete(self, request):
        serializer = ProfileDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            delete_profile(
                user_id=request.user.id,
                version=serializer.validated_data['version'],
                request=request,
            )
        except ProfileServiceError as error:
            return _error_response(error)

        response = Response(status=status.HTTP_204_NO_CONTENT)
        _delete_refresh_cookie(response)
        return response


class AvatarView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        uploaded_file = request.FILES.get('avatar')
        if uploaded_file is None:
            return Response(
                {'avatar': ['Выберите файл изображения.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            user = upload_avatar(
                user_id=request.user.id,
                uploaded_file=uploaded_file,
                request=request,
            )
        except ProfileServiceError as error:
            return _error_response(error)

        return Response(
            ProfileSerializer(user, context={'request': request}).data,
            status=status.HTTP_200_OK,
        )

    def delete(self, request):
        try:
            delete_avatar(user_id=request.user.id, request=request)
        except ProfileServiceError as error:
            return _error_response(error)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            change_password(
                user_id=request.user.id,
                request=request,
                **serializer.validated_data,
            )
        except ProfileServiceError as error:
            return _error_response(error)

        response = Response(
            {
                'message': (
                    'Пароль успешно изменён. Выполните вход повторно.'
                ),
            },
            status=status.HTTP_200_OK,
        )
        _delete_refresh_cookie(response)
        return response
