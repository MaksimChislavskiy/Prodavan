import uuid

from .models import Task
from .views import (
    TaskDashboardView,
    TaskHistoryView,
    TasksView,
    validation_response,
)


LIMIT_ERROR = 'Значение должно быть от 1 до 100.'


def _validate_optional_limit(request):
    value = request.query_params.get('limit')
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return validation_response({'limit': [LIMIT_ERROR]})
    if not 1 <= parsed <= 100:
        return validation_response({'limit': [LIMIT_ERROR]})
    return None


class TaskListCreateView(TasksView):
    """Public task collection contract with precise parameter validation."""

    def get(self, request):
        error_response = _validate_optional_limit(request)
        if error_response is not None:
            return error_response
        return super().get(request)

    def post(self, request):
        idempotency_key = request.headers.get('Idempotency-Key', '').strip()
        if idempotency_key:
            try:
                parsed_key = uuid.UUID(idempotency_key)
            except (ValueError, AttributeError):
                return validation_response({
                    'Idempotency-Key': ['Заголовок должен содержать UUID.'],
                })
            if str(parsed_key) != idempotency_key.lower():
                return validation_response({
                    'Idempotency-Key': ['Заголовок должен содержать UUID.'],
                })
        return super().post(request)


class TaskDashboardContractView(TaskDashboardView):
    """Dashboard returns the full Task DTO, not the compact kanban DTO."""

    def get(self, request):
        response = super().get(request)
        tasks = response.data.get('tasks', [])
        if not tasks:
            return response

        task_ids = [item['id'] for item in tasks]
        details = {
            str(task_id): (description, comment)
            for task_id, description, comment in Task.objects.filter(
                workspace=request.user.workspace,
                is_deleted=False,
                id__in=task_ids,
            ).values_list('id', 'description', 'comment')
        }
        for item in tasks:
            description, comment = details.get(item['id'], (None, None))
            item['description'] = description
            item['comment'] = comment
        return response


class TaskHistoryContractView(TaskHistoryView):
    def get(self, request, task_id):
        error_response = _validate_optional_limit(request)
        if error_response is not None:
            return error_response
        return super().get(request, task_id)
