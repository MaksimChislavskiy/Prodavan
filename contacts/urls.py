from django.urls import path

from .views import (
    ContactDetailView,
    ContactFindByNameView,
    ContactSearchView,
    ContactsBulkDeleteView,
    ContactsView,
)


urlpatterns = [
    path('contacts', ContactsView.as_view(), name='contacts'),
    path('contacts/bulk', ContactsBulkDeleteView.as_view(), name='contacts-bulk'),
    path('contacts/search', ContactSearchView.as_view(), name='contacts-search'),
    path(
        'contacts/find-by-name',
        ContactFindByNameView.as_view(),
        name='contacts-find-by-name',
    ),
    path(
        'contacts/<uuid:contact_id>',
        ContactDetailView.as_view(),
        name='contact-detail',
    ),
]
