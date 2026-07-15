from datetime import timedelta

from django.utils import timezone

from tasks.dates import local_day_bounds, workspace_timezone
from tasks.models import DueDateType, Task, TaskStatus

from .models import Notification, NotificationType
from .services import create_notification


DUE_SOON_WINDOW = timedelta(hours=1)
TASK_ENTITY_TYPE = 'task'


def create_task_deadline_notifications(*, now=None):
    now = now or timezone.now()
    counters = {
        'due_soon_tasks': 0,
        'overdue_tasks': 0,
        'notifications_created': 0,
    }

    tasks = (
        Task.objects.select_related('workspace')
        .filter(
            is_deleted=False,
            due_date__isnull=False,
        )
        .exclude(status=TaskStatus.DONE)
        .exclude(due_date_type=DueDateType.NONE)
        .order_by('workspace_id', 'due_date', 'id')
    )
    for task in tasks:
        notification_type = _notification_type_for_task(task, now=now)
        if notification_type is None:
            continue

        if notification_type == NotificationType.TASK_OVERDUE:
            counters['overdue_tasks'] += 1
        else:
            counters['due_soon_tasks'] += 1

        counters['notifications_created'] += _notify_task_users(
            task,
            notification_type=notification_type,
            now=now,
        )

    return counters


def _notification_type_for_task(task, *, now):
    if task.due_date_type == DueDateType.DATETIME:
        if task.due_date < now:
            return NotificationType.TASK_OVERDUE
        if now <= task.due_date <= now + DUE_SOON_WINDOW:
            return NotificationType.TASK_DUE_SOON
        return None

    tz = workspace_timezone(task.workspace)
    due_local_date = task.due_date.astimezone(tz).date()
    now_local_date = now.astimezone(tz).date()
    if due_local_date < now_local_date:
        return NotificationType.TASK_OVERDUE
    if due_local_date == now_local_date:
        return NotificationType.TASK_DUE_SOON
    return None


def _notify_task_users(task, *, notification_type, now):
    _, day_start, _ = local_day_bounds(task.workspace, now=now)
    created = 0
    for user in task.workspace.users.filter(
        is_active=True,
        is_deleted=False,
    ).order_by('created_at', 'id'):
        if _already_notified_today(
            user=user,
            task=task,
            notification_type=notification_type,
            day_start=day_start,
        ):
            continue
        create_notification(
            user=user,
            type=notification_type,
            title=_notification_title(notification_type),
            content=_notification_content(task, notification_type, now=now),
            link=f'/tasks/{task.id}',
            entity_type=TASK_ENTITY_TYPE,
            entity_id=str(task.id),
            now=now,
        )
        created += 1
    return created


def _already_notified_today(*, user, task, notification_type, day_start):
    return Notification.objects.filter(
        user=user,
        type=notification_type,
        entity_type=TASK_ENTITY_TYPE,
        entity_id=str(task.id),
        is_deleted=False,
        created_at__gte=day_start,
    ).exists()


def _notification_title(notification_type):
    if notification_type == NotificationType.TASK_OVERDUE:
        return 'Задача просрочена'
    return 'Скоро срок задачи'


def _notification_content(task, notification_type, *, now):
    title = task.title.strip()
    if notification_type == NotificationType.TASK_OVERDUE:
        return f'Задача «{title}» просрочена.'

    if task.due_date_type == DueDateType.DATE:
        return f'Сегодня срок задачи «{title}».'

    tz = workspace_timezone(task.workspace)
    due_time = task.due_date.astimezone(tz).strftime('%H:%M')
    return f'Срок задачи «{title}» наступит сегодня в {due_time}.'
