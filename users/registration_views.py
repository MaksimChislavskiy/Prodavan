from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import ForgotPasswordSerializer
from .services import (
    RegistrationServiceError,
    expire_registration,
    resend_registration_code,
)


class ResendRegistrationCodeView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email']
        try:
            resend_registration_code(email=email)
        except RegistrationServiceError as error:
            return Response(error.response_data, status=error.status_code)

        return Response(
            {
                'message': 'Код подтверждения отправлен на e-mail',
                'email': email,
            },
            status=status.HTTP_200_OK,
        )


class ExpireRegistrationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expire_registration(email=serializer.validated_data['email'])
        return Response(status=status.HTTP_204_NO_CONTENT)