import { apiRequest } from './apiClient'

export type TaskStatus = 'new' | 'in_progress' | 'done'
export type TaskDueDateType = 'none' | 'date' | 'datetime'

export type ApiTaskContact = {
  id: string
  name: string
  company: string | null
}

export type ApiTaskDeal = {
  id: string
  title: string
  amount: string | null
  currency: string
}

export type ApiTask = {
  id: string
  title: string
  due_date: string | null
  due_date_type: TaskDueDateType
  status: TaskStatus
  contact: ApiTaskContact | null
  deal: ApiTaskDeal | null
  created_by_ai: boolean
  created_by_user_id: string | null
  version: number
  is_overdue: boolean
  created_at: string
  updated_at: string
}

export type ApiTaskDetail = ApiTask & {
  description: string | null
  comment: string | null
}

export type ApiDashboardTask = ApiTask

export type TasksDashboardResponse = {
  tasks: ApiDashboardTask[]
  total_count: number
}

export type ApiTaskColumn = {
  tasks: ApiTask[]
  count: number
  next_cursor: string | null
}

export type TasksKanbanResponse = Record<TaskStatus, ApiTaskColumn>

export type TasksPageResponse = {
  tasks: ApiTask[]
  next_cursor: string | null
  has_more: boolean
}

export type CreateTaskRequest = {
  title: string
  description?: string | null
  due_date?: string | null
  due_date_type?: TaskDueDateType
  contact_id?: string | null
  deal_id?: string | null
  comment?: string | null
}

export type UpdateTaskRequest = {
  version: number
  title?: string
  description?: string | null
  due_date?: string | null
  due_date_type?: TaskDueDateType
  contact_id?: string | null
  deal_id?: string | null
  comment?: string | null
}

export type BulkDeleteTasksResponse = {
  deleted_count: number
  skipped_ids: {
    id: string
    reason: 'not_found' | 'already_deleted'
  }[]
}

export function getTasksDashboard(signal?: AbortSignal) {
  return apiRequest<TasksDashboardResponse>('/api/tasks/dashboard', { signal })
}

export function getTasksKanban(limit = 50, signal?: AbortSignal) {
  const searchParams = new URLSearchParams({ limit: String(limit) })

  return apiRequest<TasksKanbanResponse>(
    `/api/tasks/kanban?${searchParams.toString()}`,
    { signal },
  )
}

export function getTasksPage(
  status: TaskStatus,
  limit = 50,
  cursor?: string | null,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams({
    status,
    limit: String(limit),
  })

  if (cursor) {
    searchParams.set('cursor', cursor)
  }

  return apiRequest<TasksPageResponse>(
    `/api/tasks?${searchParams.toString()}`,
    { signal },
  )
}

export function getTask(taskId: string, signal?: AbortSignal) {
  return apiRequest<ApiTaskDetail>(`/api/tasks/${taskId}`, { signal })
}

export function createTask(
  data: CreateTaskRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return apiRequest<ApiTaskDetail>('/api/tasks', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
    body: data,
    signal,
  })
}

export function createTaskIdempotencyKey() {
  return createIdempotencyKey('task-create')
}

export function updateTask(
  taskId: string,
  data: UpdateTaskRequest,
  signal?: AbortSignal,
) {
  return apiRequest<ApiTaskDetail>(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: data,
    signal,
  })
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  version: number,
  signal?: AbortSignal,
) {
  return apiRequest<ApiTaskDetail>(`/api/tasks/${taskId}/status`, {
    method: 'PATCH',
    body: {
      status,
      version,
    },
    signal,
  })
}

export function deleteTask(taskId: string, signal?: AbortSignal) {
  return apiRequest<void>(`/api/tasks/${taskId}`, {
    method: 'DELETE',
    signal,
  })
}

export function bulkDeleteTasks(taskIds: string[], signal?: AbortSignal) {
  return apiRequest<BulkDeleteTasksResponse>('/api/tasks/bulk-delete', {
    method: 'POST',
    body: {
      task_ids: taskIds,
    },
    signal,
  })
}

function createIdempotencyKey(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
