from django.contrib import admin
from django.urls import include, path

from users.profile_views import AvatarView, ChangePasswordView, ProfileView
from workspaces.views import WorkspaceSettingsView
from workspaces.telegram_views import (
    TelegramConnectView,
    TelegramDisconnectView,
    TelegramSettingsView,
    TelegramWebhookLogsView,
    TelegramWebhookView,
)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('users.urls')),
    path('api/', include('contacts.urls')),
    path('api/', include('messaging.urls')),
    path('api/', include('ai_assistant.urls')),
    path('api/profile', ProfileView.as_view(), name='profile'),
    path('api/profile/avatar', AvatarView.as_view(), name='profile-avatar'),
    path(
        'api/profile/change-password',
        ChangePasswordView.as_view(),
        name='profile-change-password',
    ),
    path(
        'api/workspace/settings',
        WorkspaceSettingsView.as_view(),
        name='workspace-settings',
    ),
    path(
        'api/settings/integrations/telegram',
        TelegramSettingsView.as_view(),
        name='telegram-settings',
    ),
    path(
        'api/settings/integrations/telegram/connect',
        TelegramConnectView.as_view(),
        name='telegram-connect',
    ),
    path(
        'api/settings/integrations/telegram/disconnect',
        TelegramDisconnectView.as_view(),
        name='telegram-disconnect',
    ),
    path(
        'api/settings/integrations/telegram/webhook-logs',
        TelegramWebhookLogsView.as_view(),
        name='telegram-webhook-logs',
    ),
    path(
        'api/integrations/telegram/webhook/<str:workspace_secret>',
        TelegramWebhookView.as_view(),
        name='telegram-webhook',
    ),
]
