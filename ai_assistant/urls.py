from django.urls import path

from .views import (
    AISettingsView,
    KnowledgeFileDetailView,
    KnowledgeFileRetryView,
    KnowledgeFilesView,
)


urlpatterns = [
    path('ai/settings', AISettingsView.as_view(), name='ai-settings'),
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
]
