from django.urls import path

from .attachment_views import MessageAttachmentView
from .views import (
    ChatDetailView,
    ChatMessagesView,
    ChatReadView,
    ChatSettingsView,
    ChatsView,
)


urlpatterns = [
    path('chats', ChatsView.as_view(), name='chats'),
    path(
        'chats/<uuid:chat_id>/messages',
        ChatMessagesView.as_view(),
        name='chat-messages',
    ),
    path(
        'chats/<uuid:chat_id>/read',
        ChatReadView.as_view(),
        name='chat-read',
    ),
    path(
        'chats/<uuid:chat_id>/settings',
        ChatSettingsView.as_view(),
        name='chat-settings',
    ),
    path(
        'chats/<uuid:chat_id>',
        ChatDetailView.as_view(),
        name='chat-detail',
    ),
    path(
        'messages/<uuid:message_id>/attachment',
        MessageAttachmentView.as_view(),
        name='message-attachment',
    ),
]
