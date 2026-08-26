from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from messaging.realtime import broadcast_user_event
from tasks.dates import local_day_bounds, workspace_timezone
from tasks.models import DueDateType, Task, TaskStatus
from workspaces.models import Workspace

from .models import Notification, NotificationType
from .services import create_notification, notification_payload, unread_count


DUE_SOON_WINDOW = timedelta(hours=1)
TASK_ENTITY_TYPE = 'task'
OVERDUE_SUMMARY_ENTITY_TYPE = 'task_overdue_summary'
OVERDUE_SUMMARY_HOUR = 9


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


def create_overdue_task_summary_notifications(*, now=None, force=False):
    """Synchronize the single overdue-task summary notification for each user.

    Scheduled runs are active during the workspace-local 09:00 hour. Repeated worker
    iterations are idempotent: an existing summary is only changed when the count changes.
    ``force=True`` is used when a user receives a new session token so the requirement to
    check overdue tasks on the first login is also covered.
    """
    now = now or timezone.now()
    counters = {
        'workspaces_checked': 0,
        'users_checked': 0,
        'summaries_changed': 0,
    }

    workspaces = Workspace.objects.all().order_by('id')
    for workspace in workspaces:
        local_now = now.astimezone(workspace_timezone(workspace))
        if not force and local_now.hour != OVERDUE_SUMMARY_HOUR:
            continue

        counters['workspaces_checked'] += 1
        users = workspace.users.filter(
            is_active=True,
            is_deleted=False,
        ).order_by('created_at', 'id')
        for user in users:
            counters['users_checked'] += 1
            counters['summaries_changed'] += sync_overdue_task_summary_for_user(
                user,
                now=now,
            )

    return counters


def sync_overdue_task_summary_for_user(user, *, now=None):
    """Create, update or remove the user's aggregate overdue-task notification."""
    if not user.is_active or user.is_deleted:
        return 0

    now = now or timezone.now()
    workspace = user.workspace
    count = overdue_task_count(workspace, now=now)
    entity_id = str(workspace.id)

    with transaction.atomic():
        existing = (
            Notification.objects.select_for_update()
            .filter(
                user=user,
                type=NotificationType.TASK_OVERDUE,
                entity_type=OVERDUE_SUMMARY_ENTITY_TYPE,
                entity_id=entity_id,
                is_deleted=False,
            )
            .order_by('-created_at', '-id')
            .first()
        )

        if count == 0:
            if existing is None:
                return 0
            existing.is_deleted = True
            existing.deleted_at = now
            existing.save(update_fields=('is_deleted', 'deleted_at', 'updated_at'))
            _broadcast_summary_deleted(user.id, existing.id)
            return 1

        content = f'У вас {count} просроченных задач'
        if existing is None:
            create_notification(
                user=user,
                type=NotificationType.TASK_OVERDUE,
                title='Просроченные задачи',
                content=content,
                link='/app/tasks',
                entity_type=OVERDUE_SUMMARY_ENTITY_TYPE,
                entity_id=entity_id,
                now=now,
            )
            return 1

        if existing.content == content:
            return 0

        existing.title = 'Просроченные задачи'
        existing.content = content
        existing.link = '/app/tasks'
        existing.is_read = False
        existing.read_at = None
        existing.save(
            update_fields=(
                'title',
                'content',
                'link',
                'is_read',
                'read_at',
                'updated_at',
            ),
        )
        _broadcast_summary_updated(user.id, existing)
        return 1


def overdue_task_count(workspace, *, now=None):
    now = now or timezone.now()
    _, local_day_start, _ = local_day_bounds(workspace, now=now)
    return (
        Task.objects.filter(
            workspace=workspace,
            is_deleted=False,
            due_date__isnull=False,
        )
        .exclude(status=TaskStatus.DONE)
        .filter(
            Q(due_date_type=DueDateType.DATETIME, due_date__lt=now)
            | Q(due_date_type=DueDateType.DATE, due_date__lt=local_day_start),
        )
        .count()
    )


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


def _broadcast_summary_updated(user_id, notification):
    transaction.on_commit(
        lambda: broadcast_user_event(
            user_id,
            {
                'event': 'notification_updated',
                'payload': notification_payload(notification),
            },
        ),
    )
    transaction.on_commit(
        lambda: broadcast_user_event(
            user_id,
            {
                'event': 'unread_count_updated',
                'payload': {'unread_count': unread_count(notification.user)},
            },
        ),
    )


def _broadcast_summary_deleted(user_id, notification_id):
    transaction.on_commit(
        lambda: broadcast_user_event(
            user_id,
            {
                'event': 'notification_deleted',
                'payload': {'id': str(notification_id)},
            },
        ),
    )
    transaction.on_commit(
        lambda: broadcast_user_event(
            user_id,
            {
                'event': 'unread_count_updated',
                'payload': {
                    'unread_count': Notification.objects.filter(
                        user_id=user_id,
                        is_deleted=False,
                        is_read=False,
                    ).count(),
                },
            },
        ),
    )
