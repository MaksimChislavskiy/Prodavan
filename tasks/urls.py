from django.urls import path

from .views import (
    TaskBulkDeleteView,
    TaskDashboardView,
    TaskDetailView,
    TaskHistoryView,
    TaskKanbanView,
    TasksView,
    TaskStatusView,
)


urlpatterns = [
    path('tasks/kanban', TaskKanbanView.as_view(), name='task-kanban'),
    path('tasks/dashboard', TaskDashboardView.as_view(), name='task-dashboard'),
    path('tasks/bulk-delete', TaskBulkDeleteView.as_view(), name='task-bulk-delete'),
    path('tasks', TasksView.as_view(), name='tasks'),
    path('tasks/<uuid:task_id>', TaskDetailView.as_view(), name='task-detail'),
    path(
        'tasks/<uuid:task_id>/status',
        TaskStatusView.as_view(),
        name='task-status',
    ),
    path(
        'tasks/<uuid:task_id>/history',
        TaskHistoryView.as_view(),
        name='task-history',
    ),
]
