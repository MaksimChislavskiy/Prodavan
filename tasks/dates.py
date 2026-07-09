from datetime import datetime, time, timedelta, timezone as datetime_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import serializers

from .models import DueDateType, TaskStatus


def workspace_timezone(workspace):
    try:
        return ZoneInfo(workspace.timezone or 'UTC')
    except ZoneInfoNotFoundError:
        return ZoneInfo('UTC')


def normalize_due_date(value, *, workspace):
    if value is None or isinstance(value, datetime):
        parsed = value
    elif not isinstance(value, str):
        raise serializers.ValidationError('Некорректная дата выполнения.')
    else:
        value = value.strip()
        parsed = parse_datetime(value)
        if parsed is None:
            parsed_date = parse_date(value)
            if parsed_date is None:
                raise serializers.ValidationError('Некорректная дата выполнения.')
            parsed = datetime.combine(parsed_date, time.min)
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        parsed = parsed.replace(tzinfo=workspace_timezone(workspace))
    return parsed.astimezone(datetime_timezone.utc)


def canonicalize_due_date(due_date_type, due_date, *, workspace):
    if due_date_type != DueDateType.DATE or due_date is None:
        return due_date
    tz = workspace_timezone(workspace)
    local_date = due_date.astimezone(tz).date()
    local_midnight = datetime.combine(local_date, time.min, tzinfo=tz)
    return local_midnight.astimezone(datetime_timezone.utc)


def local_day_bounds(workspace, now=None):
    now = now or timezone.now()
    tz = workspace_timezone(workspace)
    local_now = now.astimezone(tz)
    start = datetime.combine(local_now.date(), time.min, tzinfo=tz)
    end = start + timedelta(days=1)
    return local_now, start.astimezone(datetime_timezone.utc), end.astimezone(datetime_timezone.utc)


def is_task_overdue(task, *, now=None):
    if (
        task.status == TaskStatus.DONE
        or task.due_date is None
        or task.due_date_type == DueDateType.NONE
    ):
        return False
    now = now or timezone.now()
    if task.due_date_type == DueDateType.DATETIME:
        return task.due_date < now
    tz = workspace_timezone(task.workspace)
    return task.due_date.astimezone(tz).date() < now.astimezone(tz).date()
