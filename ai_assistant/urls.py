from django.urls import path

from .chat_views import (
    AIChatHistoryView,
    AIChatMessageView,
    AIChatRetryView,
    AIChatSessionCloseView,
    AIChatSessionCreateView,
    AIChatSessionDetailView,
    AIChatSessionsView,
    AIChatView,
)
from .reset_views import AISettingsResetView
from .views import (
    AIAuditView,
    AISettingsView,
    KnowledgeFileDetailView,
    KnowledgeFileRetryView,
    KnowledgeFilesView,
)


urlpatterns = [
    path('ai/settings', AISettingsView.as_view(), name='ai-settings'),
    path(
        'ai/settings/reset',
        AISettingsResetView.as_view(),
        name='ai-settings-reset',
    ),
    path('ai/audit', AIAuditView.as_view(), name='ai-audit'),
    path(
        'ai/knowledge-base/files',
        KnowledgeFilesView.as_view(),
        name='knowledge-files',
    ),
    path(
        'ai/knowledge-base/files/<uuid:document_id>',
        KnowledgeFileDetailView.as_view(),
        name='knowledge-file-detail',
    ),
    path(
        'ai/knowledge-base/files/<uuid:document_id>/retry',
        KnowledgeFileRetryView.as_view(),
        name='knowledge-file-retry',
    ),
    path('ai/chat/session', AIChatSessionCreateView.as_view(), name='ai-chat-session'),
    path('ai/chat/sessions', AIChatSessionsView.as_view(), name='ai-chat-sessions'),
    path(
        'ai/chat/session/<uuid:session_id>',
        AIChatSessionDetailView.as_view(),
        name='ai-chat-session-detail',
    ),
    path(
        'ai/chat/session/<uuid:session_id>/close',
        AIChatSessionCloseView.as_view(),
        name='ai-chat-session-close',
    ),
    path('ai/chat', AIChatView.as_view(), name='ai-chat'),
    path('ai/chat/retry', AIChatRetryView.as_view(), name='ai-chat-retry'),
    path('ai/chat/history', AIChatHistoryView.as_view(), name='ai-chat-history'),
    path(
        'ai/chat/message/<uuid:message_id>',
        AIChatMessageView.as_view(),
        name='ai-chat-message',
    ),
]
