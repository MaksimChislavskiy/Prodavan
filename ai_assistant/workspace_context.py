from django.db.models import (
    Case,
    Count,
    F,
    IntegerField,
    Q,
    Sum,
    Value,
    When,
)
from django.utils import timezone

from contacts.models import Contact
from deals.models import Deal
from messaging.models import Chat
from notifications.models import Notification
from tasks.dates import is_task_overdue, local_day_bounds
from tasks.models import DueDateType, Task, TaskStatus


MAX_SUMMARY_ITEMS = 20


def build_workspace_context(session, page, *, now=None):
    now = now or timezone.now()
    workspace = session.workspace
    local_now, day_start, day_end = local_day_bounds(workspace, now=now)

    contacts = Contact.objects.filter(
        workspace_id=session.workspace_id,
        is_deleted=False,
    )
    deals = Deal.objects.filter(
        workspace_id=session.workspace_id,
        stage__workspace_id=session.workspace_id,
        is_deleted=False,
    )
    tasks = Task.objects.filter(
        workspace_id=session.workspace_id,
        is_deleted=False,
    )
    chats = Chat.objects.filter(
        workspace_id=session.workspace_id,
        is_deleted=False,
    )
    unread_notifications = Notification.objects.filter(
        workspace_id=session.workspace_id,
        user_id=session.user_id,
        is_deleted=False,
        is_read=False,
    )

    task_counts = {status: 0 for status in TaskStatus.values}
    for row in tasks.values('status').annotate(count=Count('id')):
        task_counts[row['status']] = row['count']

    chat_totals = chats.aggregate(
        count=Count('id'),
        unread_messages=Sum('unread_count'),
    )
    important_tasks = _important_tasks(
        tasks,
        now=now,
        day_start=day_start,
        day_end=day_end,
    )
    attention_deals = _attention_deals(
        deals,
        workspace_id=session.workspace_id,
        now=now,
        day_start=day_start,
    )
    notification_count = unread_notifications.count()
    notification_rows = list(
        unread_notifications.order_by('-created_at', '-id')[:MAX_SUMMARY_ITEMS],
    )

    return {
        'page': page,
        'entity_id': None,
        'scope': 'workspace_summary',
        'generated_at': now.isoformat(),
        'workspace': {
            'id': str(workspace.id),
            'name': workspace.name,
            'timezone': workspace.timezone,
            'local_datetime': local_now.isoformat(),
        },
        'counts': {
            'contacts': contacts.count(),
            'deals': deals.count(),
            'tasks': {
                'total': sum(task_counts.values()),
                'by_status': task_counts,
            },
            'chats': chat_totals['count'],
            'unread_chat_messages': chat_totals['unread_messages'] or 0,
            'unread_notifications': notification_count,
        },
        'deals_by_stage': [
            {
                'stage_id': str(row['stage_id']),
                'stage_name': row['stage__name'],
                'deal_count': row['deal_count'],
            }
            for row in deals.values('stage_id', 'stage__name')
            .annotate(deal_count=Count('id'))
            .order_by('stage__order', 'stage_id')
        ],
        'deal_amounts_by_currency': [
            {
                'currency': row['currency'],
                'deal_count': row['deal_count'],
                'total_amount': (
                    str(row['total_amount'])
                    if row['total_amount'] is not None
                    else None
                ),
            }
            for row in deals.values('currency')
            .annotate(deal_count=Count('id'), total_amount=Sum('amount'))
            .order_by('currency')
        ],
        'important_task_count': important_tasks['count'],
        'important_tasks_truncated': important_tasks['truncated'],
        'important_tasks': important_tasks['items'],
        'attention_deal_count': attention_deals['count'],
        'attention_deals_truncated': attention_deals['truncated'],
        'attention_deals': attention_deals['items'],
        'unread_notifications_truncated': (
            notification_count > len(notification_rows)
        ),
        'unread_notifications': [
            {
                'id': str(notification.id),
                'type': notification.type,
                'title': notification.title,
                'content': notification.content,
                'link': notification.link,
                'entity_type': notification.entity_type,
                'entity_id': notification.entity_id,
                'created_at': notification.created_at.isoformat(),
            }
            for notification in notification_rows
        ],
    }


def _important_tasks(tasks, *, now, day_start, day_end):
    overdue = (
        Q(due_date_type=DueDateType.DATE, due_date__lt=day_start)
        | Q(due_date_type=DueDateType.DATETIME, due_date__lt=now)
    )
    queryset = (
        tasks.select_related('workspace', 'contact', 'deal')
        .filter(status__in=(TaskStatus.NEW, TaskStatus.IN_PROGRESS))
        .filter(
            Q(due_date__lt=day_end)
            | Q(due_date__isnull=True)
            | Q(due_date_type=DueDateType.NONE),
        )
        .annotate(
            summary_priority=Case(
                When(overdue, then=Value(0)),
                When(due_date_type=DueDateType.DATETIME, then=Value(1)),
                When(due_date_type=DueDateType.DATE, then=Value(2)),
                default=Value(3),
                output_field=IntegerField(),
            ),
        )
        .order_by(
            'summary_priority',
            F('due_date').asc(nulls_last=True),
            '-created_at',
            '-id',
        )
    )
    count = queryset.count()
    rows = list(queryset[:MAX_SUMMARY_ITEMS])
    return {
        'count': count,
        'truncated': count > len(rows),
        'items': [_task_item(task, now=now) for task in rows],
    }


def _task_item(task, *, now):
    contact = None
    if (
        task.contact is not None
        and task.contact.workspace_id == task.workspace_id
        and not task.contact.is_deleted
    ):
        contact = {
            'id': str(task.contact.id),
            'name': task.contact.name,
            'company': task.contact.company,
        }
    deal = None
    if (
        task.deal is not None
        and task.deal.workspace_id == task.workspace_id
        and not task.deal.is_deleted
    ):
        deal = {'id': str(task.deal.id), 'name': task.deal.name}
    return {
        'id': str(task.id),
        'title': task.title,
        'description': task.description,
        'status': task.status,
        'due_date': task.due_date.isoformat() if task.due_date else None,
        'due_date_type': task.due_date_type,
        'is_overdue': is_task_overdue(task, now=now),
        'contact': contact,
        'deal': deal,
    }


def _attention_deals(deals, *, workspace_id, now, day_start):
    overdue_tasks = (
        Q(tasks__workspace_id=workspace_id)
        & Q(tasks__is_deleted=False)
        & Q(tasks__status__in=(TaskStatus.NEW, TaskStatus.IN_PROGRESS))
        & (
            Q(
                tasks__due_date_type=DueDateType.DATETIME,
                tasks__due_date__lt=now,
            )
            | Q(
                tasks__due_date_type=DueDateType.DATE,
                tasks__due_date__lt=day_start,
            )
        )
    )
    queryset = (
        deals.select_related('stage', 'contact')
        .annotate(
            overdue_task_count=Count(
                'tasks',
                filter=overdue_tasks,
                distinct=True,
            ),
        )
        .filter(overdue_task_count__gt=0)
        .order_by('-overdue_task_count', '-updated_at', '-id')
    )
    count = queryset.count()
    rows = list(queryset[:MAX_SUMMARY_ITEMS])
    return {
        'count': count,
        'truncated': count > len(rows),
        'items': [_attention_deal_item(deal) for deal in rows],
    }


def _attention_deal_item(deal):
    contact = None
    if (
        deal.contact is not None
        and deal.contact.workspace_id == deal.workspace_id
        and not deal.contact.is_deleted
    ):
        contact = {
            'id': str(deal.contact.id),
            'name': deal.contact.name,
            'company': deal.contact.company,
        }
    return {
        'id': str(deal.id),
        'name': deal.name,
        'stage': {
            'id': str(deal.stage.id),
            'name': deal.stage.name,
        },
        'amount': str(deal.amount) if deal.amount is not None else None,
        'currency': deal.currency,
        'contact': contact,
        'overdue_task_count': deal.overdue_task_count,
    }
