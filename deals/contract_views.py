import uuid

from django.db import IntegrityError
from rest_framework import status

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

        try:
            return super().post(request)
        except IntegrityError:
            # Два одинаковых POST могут одновременно не увидеть idempotency-запись.
            # Один запрос фиксирует её первым, второй откатывается по unique constraint.
            # После отката повторный вызов уже читает сохранённый результат и не создаёт
            # вторую сделку.
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

        response = super().patch(request, deal_id)

        if key is not None and response.status_code == status.HTTP_409_CONFLICT:
            # При двух одновременных перемещениях второй запрос может успеть проверить
            # idempotency-key до коммита первого, а после ожидания row lock получить
            # VERSION_CONFLICT. Повторная попытка сначала увидит уже сохранённый
            # idempotent result и вернёт тот же успешный ответ вместо ложного 409.
            return super().patch(request, deal_id)

        return response
