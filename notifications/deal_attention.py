from django.db.models import F
from django.utils import timezone

from tasks.dates import is_task_overdue, local_day_bounds
from tasks.models import DueDateType, Task, TaskStatus

from .models import Notification, NotificationType
from .services import create_notification


DEAL_ENTITY_TYPE = 'deal'


def create_deal_attention_notifications(*, now=None):
    now = now or timezone.now()
    overdue_by_deal = {}

    tasks = (
        Task.objects.select_related('workspace', 'deal', 'deal__workspace')
        .filter(
            deal__isnull=False,
            deal__is_deleted=False,
            deal__workspace_id=F('workspace_id'),
            is_deleted=False,
            due_date__isnull=False,
        )
        .exclude(status=TaskStatus.DONE)
        .exclude(due_date_type=DueDateType.NONE)
        .order_by('workspace_id', 'deal_id', 'due_date', 'id')
    )
    for task in tasks:
        if not is_task_overdue(task, now=now):
            continue
        overdue_by_deal.setdefault(task.deal_id, []).append(task)

    counters = {
        'deals_requiring_attention': len(overdue_by_deal),
        'overdue_tasks': sum(len(tasks) for tasks in overdue_by_deal.values()),
        'notifications_created': 0,
    }
    for overdue_tasks in overdue_by_deal.values():
        counters['notifications_created'] += _notify_deal_users(
            overdue_tasks[0].deal,
            overdue_tasks=overdue_tasks,
            now=now,
        )
    return counters


def _notify_deal_users(deal, *, overdue_tasks, now):
    _, day_start, _ = local_day_bounds(deal.workspace, now=now)
    created = 0
    for user in deal.workspace.users.filter(
        is_active=True,
        is_deleted=False,
    ).order_by('created_at', 'id'):
        if _already_notified_today(
            user=user,
            deal=deal,
            day_start=day_start,
        ):
            continue
        create_notification(
            user=user,
            type=NotificationType.DEAL_ATTENTION,
            title='Сделка требует внимания',
            content=_notification_content(deal, overdue_tasks),
            link=f'/deals/{deal.id}',
            entity_type=DEAL_ENTITY_TYPE,
            entity_id=str(deal.id),
            now=now,
        )
        created += 1
    return created


def _already_notified_today(*, user, deal, day_start):
    return Notification.objects.filter(
        user=user,
        type=NotificationType.DEAL_ATTENTION,
        entity_type=DEAL_ENTITY_TYPE,
        entity_id=str(deal.id),
        is_deleted=False,
        created_at__gte=day_start,
    ).exists()


def _notification_content(deal, overdue_tasks):
    deal_name = deal.name.strip()
    if len(overdue_tasks) == 1:
        task_title = overdue_tasks[0].title.strip()
        return f'В сделке «{deal_name}» просрочена задача «{task_title}».'
    return f'В сделке «{deal_name}» просрочено задач: {len(overdue_tasks)}.'
