import type { TaskDueDateType } from './api/tasksApi'

type TaskDeadline = {
  due_date: string | null
  due_date_type: TaskDueDateType
}

type DateParts = {
  year: string
  month: string
  day: string
  hour: string
  minute: string
}

const FALLBACK_TIMEZONE = 'UTC'

export function formatTaskDueDateForDisplay(
  task: TaskDeadline,
  workspaceTimezone: string,
  now = new Date(),
) {
  if (!task.due_date || task.due_date_type === 'none') {
    return 'Без срока'
  }

  const dueDate = new Date(task.due_date)
  if (Number.isNaN(dueDate.getTime())) {
    return 'Срок не указан'
  }

  const timeZone = resolveTimeZone(workspaceTimezone)
  const dueDateKey = formatDateKey(dueDate, timeZone)
  const todayKey = formatDateKey(now, timeZone)
  const isToday = dueDateKey === todayKey

  if (task.due_date_type === 'date') {
    if (isToday) {
      return 'сегодня'
    }

    return new Intl.DateTimeFormat('ru-RU', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(dueDate)
  }

  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(dueDate)

  if (isToday) {
    return `сегодня, ${time}`
  }

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(dueDate)
}

export function formatTaskDueDateForInput(
  task: TaskDeadline,
  workspaceTimezone: string,
) {
  if (!task.due_date || task.due_date_type === 'none') {
    return ''
  }

  const dueDate = new Date(task.due_date)
  if (Number.isNaN(dueDate.getTime())) {
    return ''
  }

  const parts = getDateParts(dueDate, resolveTimeZone(workspaceTimezone))
  const date = `${parts.year}-${parts.month}-${parts.day}`

  if (task.due_date_type === 'date') {
    return date
  }

  return `${date}T${parts.hour}:${parts.minute}`
}

function formatDateKey(date: Date, timeZone: string) {
  const parts = getDateParts(date, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function getDateParts(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  ) as Record<string, string>

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  }
}

function resolveTimeZone(value: string) {
  const timeZone = value || FALLBACK_TIMEZONE

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0))
    return timeZone
  } catch {
    return FALLBACK_TIMEZONE
  }
}
