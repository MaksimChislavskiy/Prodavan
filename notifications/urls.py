from django.urls import path

from .views import (
    NotificationDeleteAllView,
    NotificationDetailView,
    NotificationMarkAllReadView,
    NotificationReadView,
    NotificationUnreadCountView,
    NotificationsView,
)


urlpatterns = [
    path('notifications', NotificationsView.as_view(), name='notifications'),
    path(
        'notifications/unread-count',
        NotificationUnreadCountView.as_view(),
        name='notification-unread-count',
    ),
    path(
        'notifications/mark-all-read',
        NotificationMarkAllReadView.as_view(),
        name='notification-mark-all-read',
    ),
    path(
        'notifications/all',
        NotificationDeleteAllView.as_view(),
        name='notification-delete-all',
    ),
    path(
        'notifications/<uuid:notification_id>',
        NotificationDetailView.as_view(),
        name='notification-detail',
    ),
    path(
        'notifications/<uuid:notification_id>/read',
        NotificationReadView.as_view(),
        name='notification-read',
    ),
]
