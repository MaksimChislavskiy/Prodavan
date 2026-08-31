import uuid

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
        return super().patch(request, deal_id)
