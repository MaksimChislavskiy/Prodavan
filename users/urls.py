from django.urls import path

from .views import (
    ConfirmRegistrationView,
    ConfirmPasswordResetView,
    ForgotPasswordView,
    LoginView,
    LogoutView,
    MeView,
    RefreshSessionView,
    RegisterView,
    ResetPasswordView,
)


urlpatterns = [
    path('register', RegisterView.as_view(), name='register'),
    path('confirm', ConfirmRegistrationView.as_view(), name='confirm-registration'),
    path('login', LoginView.as_view(), name='login'),
    path('refresh', RefreshSessionView.as_view(), name='refresh-session'),
    path('logout', LogoutView.as_view(), name='logout'),
    path('me', MeView.as_view(), name='me'),
    path('forgot-password', ForgotPasswordView.as_view(), name='forgot-password'),
    path(
        'reset-password/confirm',
        ConfirmPasswordResetView.as_view(),
        name='confirm-password-reset',
    ),
    path('reset-password', ResetPasswordView.as_view(), name='reset-password'),
]
