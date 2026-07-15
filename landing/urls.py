from django.urls import path

from landing.views import LandingPageView

app_name = 'landing'

urlpatterns = [
    path('', LandingPageView.as_view(), name='index'),
]
