from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Contact
from .serializers import (
    ContactAutocompleteSerializer,
    ContactBulkDeleteSerializer,
    ContactCreateSerializer,
    ContactReadSerializer,
    ContactUpdateSerializer,
)
from .services import (
    ContactServiceError,
    bulk_delete_contacts,
    create_contact,
    delete_contact,
    request_audit_context,
    update_contact,
)


def _validation_response(errors):
    flattened = {}
    for field, messages in errors.items():
        if isinstance(messages, (list, tuple)) and messages:
            flattened[field] = str(messages[0])
        else:
            flattened[field] = str(messages)
    return Response(
        {'message': 'Validation failed', 'errors': flattened},
        status=status.HTTP_400_BAD_REQUEST,
    )


def _positive_int(value, *, default, minimum, maximum, field):
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError(field) from None
    if not minimum <= parsed <= maximum:
        raise ValueError(field)
    return parsed


class ContactsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            page = _positive_int(
                request.query_params.get('page'),
                default=1,
                minimum=1,
                maximum=2_147_483_647,
                field='page',
            )
            limit = _positive_int(
                request.query_params.get('limit'),
                default=20,
                minimum=1,
                maximum=100,
                field='limit',
            )
        except ValueError as error:
            return _validation_response(
                {str(error): ['Некорректное значение.']},
            )
        sort = request.query_params.get('sort', 'name:asc,id:asc')
        if sort != 'name:asc,id:asc':
            return _validation_response(
                {'sort': ['Поддерживается только name:asc,id:asc.']},
            )

        queryset = Contact.objects.filter(
            workspace=request.user.workspace,
            is_deleted=False,
        ).order_by('name_search', 'id')
        total = queryset.count()
        offset = (page - 1) * limit
        contacts = queryset[offset:offset + limit]
        return Response(
            {
                'contacts': ContactReadSerializer(contacts, many=True).data,
                'total': total,
                'page': page,
                'limit': limit,
            },
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        serializer = ContactCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return _validation_response(serializer.errors)
        contact = create_contact(
            workspace=request.user.workspace,
            user=request.user,
            data=serializer.validated_data,
            audit_context=request_audit_context(request),
        )
        return Response(
            ContactReadSerializer(contact).data,
            status=status.HTTP_201_CREATED,
        )


class ContactDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _contact(request, contact_id):
        return Contact.objects.filter(
            id=contact_id,
            workspace=request.user.workspace,
            is_deleted=False,
        ).first()

    def get(self, request, contact_id):
        contact = self._contact(request, contact_id)
        if contact is None:
            return Response(
                {'error': {'code': 'CONTACT_NOT_FOUND', 'message': 'Контакт не найден.'}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(ContactReadSerializer(contact).data)

    def patch(self, request, contact_id):
        serializer = ContactUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return _validation_response(serializer.errors)
        data = dict(serializer.validated_data)
        submitted_version = data.pop('version')
        try:
            contact = update_contact(
                workspace=request.user.workspace,
                user=request.user,
                contact_id=contact_id,
                submitted_version=submitted_version,
                data=data,
                audit_context=request_audit_context(request),
            )
        except ContactServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(ContactReadSerializer(contact).data)

    def delete(self, request, contact_id):
        try:
            delete_contact(
                workspace=request.user.workspace,
                user=request.user,
                contact_id=contact_id,
                audit_context=request_audit_context(request),
            )
        except ContactServiceError as error:
            return Response(error.response_data, status=error.status_code)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ContactsBulkDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request):
        serializer = ContactBulkDeleteSerializer(data=request.data)
        if not serializer.is_valid():
            return _validation_response(serializer.errors)
        result = bulk_delete_contacts(
            workspace=request.user.workspace,
            user=request.user,
            contact_ids=serializer.validated_data['contact_ids'],
            audit_context=request_audit_context(request),
        )
        return Response(result, status=status.HTTP_200_OK)


class ContactSearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        query = request.query_params.get('query', '').strip()
        if not query or len(query) > 100:
            return _validation_response(
                {'query': ['Укажите строку поиска длиной до 100 символов.']},
            )
        try:
            limit = _positive_int(
                request.query_params.get('limit'),
                default=5,
                minimum=1,
                maximum=10,
                field='limit',
            )
        except ValueError:
            return _validation_response(
                {'limit': ['Значение должно быть от 1 до 10.']},
            )
        contacts = Contact.objects.filter(
            workspace=request.user.workspace,
            is_deleted=False,
            name_search__contains=query.casefold(),
        ).order_by('name_search', 'id')[:limit]
        return Response(ContactAutocompleteSerializer(contacts, many=True).data)


class ContactFindByNameView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        name = request.query_params.get('name', '').strip()
        if not name or len(name) > 100:
            return _validation_response(
                {'name': ['Укажите ФИО длиной до 100 символов.']},
            )
        contact = Contact.objects.filter(
            workspace=request.user.workspace,
            is_deleted=False,
            name_search=name.casefold(),
        ).order_by('id').first()
        if contact is None:
            return Response(None, status=status.HTTP_200_OK)
        return Response(ContactAutocompleteSerializer(contact).data)
