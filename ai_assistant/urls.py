from django.urls import path

from .views import AISettingsView


urlpatterns = [
    path('ai/settings', AISettingsView.as_view(), name='ai-settings'),
]
