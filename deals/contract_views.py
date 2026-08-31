import uuid

from django.db import transaction

from .models import Deal, SalesStage
from .views import DealStageView, DealsView, validation_response


def _is_uuid(value):
    try:
        uuid.UUID(value)
    except (AttributeError, TypeError, ValueError):
        return False
    return True


class DealsContractView(DealsView):
    def post(self, request):
        key = request.headers.get('Idempotency-Key', '').strip()
        if not key or len(key) > 255 or not _is_uuid(key):
            return validation_response({
                'Idempotency-Key': [
                    'Обязательный заголовок должен содержать UUID длиной до 255 символов.',
                ],
            })

        # Создание сделки всегда начинается с блокировки системного этапа рабочего
        # пространства. Поэтому второй одновременный запрос с тем же ключом ждёт
        # коммита первого ещё до проверки idempotency-record и затем получает уже
        # сохранённый ответ вместо попытки создать дубль.
        with transaction.atomic():
            SalesStage.objects.select_for_update().filter(
                workspace=request.user.workspace,
                is_system=True,
                is_deleted=False,
            ).first()
            return super().post(request)


class DealStageContractView(DealStageView):
    def patch(self, request, deal_id):
        key = request.headers.get('Idempotency-Key')
        if key is not None:
            normalized_key = key.strip()
            if (
                not normalized_key
                or len(normalized_key) > 255
                or not _is_uuid(normalized_key)
            ):
                return validation_response({
                    'Idempotency-Key': [
                        'Если заголовок передан, он должен содержать UUID длиной до 255 символов.',
                    ],
                })

        if key is None:
            return super().patch(request, deal_id)

        # Для идемпотентного Drag&Drop сериализуем запросы по самой сделке до
        # первого чтения idempotency-record. После ожидания row lock второй запрос
        # видит результат первого и возвращает тот же 200, а не ложный 409.
        with transaction.atomic():
            Deal.objects.select_for_update().filter(
                id=deal_id,
                workspace=request.user.workspace,
            ).first()
            return super().patch(request, deal_id)
