from django.urls import path

from .views import ChatDetailView, ChatMessagesView, ChatReadView, ChatsView


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
        'chats/<uuid:chat_id>',
        ChatDetailView.as_view(),
        name='chat-detail',
    ),
]
