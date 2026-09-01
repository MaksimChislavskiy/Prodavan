from django.db import transaction
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import PasswordResetToken, User
from .serializers import ForgotPasswordSerializer


class CancelPasswordResetView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email']

        with transaction.atomic():
            user = User.objects.filter(email__iexact=email).first()
            if user is not None:
                token = (
                    PasswordResetToken.objects.select_for_update()
                    .filter(user=user, used=False)
                    .order_by('-created_at')
                    .first()
                )
                if token is not None:
                    token.used = True
                    token.confirmed_at = None
                    token.save(update_fields=('used', 'confirmed_at', 'updated_at'))

        return Response(status=status.HTTP_204_NO_CONTENT)