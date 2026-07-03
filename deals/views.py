from django.db.models import Count, Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .cursors import decode_cursor, encode_cursor
from .models import Deal, DealHistory, SalesStage
from .serializers import (
    DealCreateSerializer,
    DealDetailSerializer,
    DealHistorySerializer,
    DealListSerializer,
    DealStageUpdateSerializer,
    DealUpdateSerializer,
    StageCreateSerializer,
    StageReadSerializer,
    StageUpdateSerializer,
)
from .services import (
    CRMServiceError,
    create_deal,
    create_stage,
    delete_deal,
    delete_stage,
    move_deal,
    update_deal,
    update_stage,
)


def validation_response(errors):
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


def service_error_response(error):
    return Response(error.response_data, status=error.status_code)


def parse_limit(value, *, default):
    try:
        result = default if value is None else int(value)
    except (TypeError, ValueError):
        raise ValueError from None
    if not 1 <= result <= 100:
        raise ValueError
    return result


def paginate(queryset, *, limit, cursor, timestamp_field):
    if cursor:
        timestamp, object_id = decode_cursor(cursor)
        queryset = queryset.filter(
            Q(**{f'{timestamp_field}__lt': timestamp})
            | Q(**{timestamp_field: timestamp, 'id__lt': object_id}),
        )
    rows = list(queryset[:limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(
            timestamp=getattr(last, timestamp_field),
            object_id=last.id,
        )
    return rows, next_cursor, has_more


class KanbanView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        stages = list(SalesStage.objects.filter(
            workspace=request.user.workspace,
            is_deleted=False,
        ).annotate(
            deal_count=Count('deals', filter=Q(deals__is_deleted=False)),
        ).order_by('order'))
        deals = {}
        for stage in stages:
            queryset = Deal.objects.filter(
                workspace=request.user.workspace,
                stage=stage,
                is_deleted=False,
            ).select_related('contact').order_by('-updated_at', '-id')[:20]
            deals[str(stage.id)] = DealListSerializer(queryset, many=True).data
        stage_data = []
        for stage in stages:
            item = dict(StageReadSerializer(stage).data)
            item['deal_count'] = stage.deal_count
            stage_data.append(item)
        return Response({'stages': stage_data, 'deals': deals})


class DealsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        stage_id = request.query_params.get('stage_id')
        if not stage_id:
            return validation_response({'stage_id': ['Обязательное поле.']})
        if not SalesStage.objects.filter(
            id=stage_id,
            workspace=request.user.workspace,
            is_deleted=False,
        ).exists():
            return Response(
                {'error': {'code': 'STAGE_NOT_FOUND', 'message': 'Этап не найден.'}},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            limit = parse_limit(request.query_params.get('limit'), default=20)
            rows, next_cursor, has_more = paginate(
                Deal.objects.filter(
                    workspace=request.user.workspace,
                    stage_id=stage_id,
                    is_deleted=False,
                ).select_related('contact').order_by('-updated_at', '-id'),
                limit=limit,
                cursor=request.query_params.get('cursor'),
                timestamp_field='updated_at',
            )
        except ValueError:
            return validation_response({'cursor': ['Некорректные параметры пагинации.']})
        return Response({
            'deals': DealListSerializer(rows, many=True).data,
            'next_cursor': next_cursor,
            'has_more': has_more,
        })

    def post(self, request):
        key = request.headers.get('Idempotency-Key', '').strip()
        if not key or len(key) > 255:
            return validation_response({
                'Idempotency-Key': ['Обязательный заголовок длиной до 255 символов.'],
            })
        serializer = DealCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return validation_response(serializer.errors)
        try:
            body, response_status = create_deal(
                workspace=request.user.workspace,
                user=request.user,
                data=dict(serializer.validated_data),
                idempotency_key=key,
            )
        except CRMServiceError as error:
            return service_error_response(error)
        return Response(body, status=response_status)


class DealDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _deal(self, request, deal_id):
        return Deal.objects.select_related('contact', 'stage').filter(
            id=deal_id,
            workspace=request.user.workspace,
            is_deleted=False,
        ).first()

    def get(self, request, deal_id):
        deal = self._deal(request, deal_id)
        if deal is None:
            return Response(
                {'error': {'code': 'DEAL_NOT_FOUND', 'message': 'Сделка не найдена.'}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(DealDetailSerializer(deal).data)

    def patch(self, request, deal_id):
        serializer = DealUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return validation_response(serializer.errors)
        data = dict(serializer.validated_data)
        submitted_version = data.pop('version')
        try:
            body = update_deal(
                workspace=request.user.workspace,
                user=request.user,
                deal_id=deal_id,
                submitted_version=submitted_version,
                data=data,
            )
        except CRMServiceError as error:
            return service_error_response(error)
        return Response(body)

    def delete(self, request, deal_id):
        try:
            delete_deal(
                workspace=request.user.workspace,
                user=request.user,
                deal_id=deal_id,
            )
        except CRMServiceError as error:
            return service_error_response(error)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DealStageView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, deal_id):
        serializer = DealStageUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return validation_response(serializer.errors)
        key = request.headers.get('Idempotency-Key')
        if key is not None:
            key = key.strip()
            if not key or len(key) > 255:
                return validation_response({
                    'Idempotency-Key': ['Заголовок должен иметь длину до 255 символов.'],
                })
        try:
            body = move_deal(
                workspace=request.user.workspace,
                user=request.user,
                deal_id=deal_id,
                stage_id=serializer.validated_data['stage_id'],
                submitted_version=serializer.validated_data['version'],
                idempotency_key=key,
            )
        except CRMServiceError as error:
            return service_error_response(error)
        return Response(body)


class DealHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, deal_id):
        if not Deal.objects.filter(
            id=deal_id,
            workspace=request.user.workspace,
        ).exists():
            return Response(
                {'error': {'code': 'DEAL_NOT_FOUND', 'message': 'Сделка не найдена.'}},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            limit = parse_limit(request.query_params.get('limit'), default=10)
            rows, next_cursor, has_more = paginate(
                DealHistory.objects.filter(
                    workspace=request.user.workspace,
                    deal_id=deal_id,
                ).select_related('changed_by').order_by('-created_at', '-id'),
                limit=limit,
                cursor=request.query_params.get('cursor'),
                timestamp_field='created_at',
            )
        except ValueError:
            return validation_response({'cursor': ['Некорректные параметры пагинации.']})
        return Response({
            'history': DealHistorySerializer(rows, many=True).data,
            'next_cursor': next_cursor,
            'has_more': has_more,
        })


class StagesView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = StageCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return validation_response(serializer.errors)
        try:
            stage = create_stage(
                workspace=request.user.workspace,
                data=dict(serializer.validated_data),
            )
        except CRMServiceError as error:
            return service_error_response(error)
        return Response(StageReadSerializer(stage).data, status=status.HTTP_201_CREATED)


class StageDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, stage_id):
        serializer = StageUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return validation_response(serializer.errors)
        data = dict(serializer.validated_data)
        submitted_version = data.pop('version')
        try:
            stage = update_stage(
                workspace=request.user.workspace,
                stage_id=stage_id,
                submitted_version=submitted_version,
                data=data,
            )
        except CRMServiceError as error:
            return service_error_response(error)
        return Response(StageReadSerializer(stage).data)

    def delete(self, request, stage_id):
        raw_version = request.headers.get('If-Match')
        if raw_version is None:
            raw_version = request.data.get('version') if isinstance(request.data, dict) else None
        try:
            submitted_version = int(str(raw_version).strip('"'))
            if submitted_version < 1:
                raise ValueError
        except (TypeError, ValueError):
            return validation_response({'version': ['Укажите текущую версию этапа.']})
        try:
            delete_stage(
                workspace=request.user.workspace,
                stage_id=stage_id,
                submitted_version=submitted_version,
            )
        except CRMServiceError as error:
            return service_error_response(error)
        return Response(status=status.HTTP_204_NO_CONTENT)
