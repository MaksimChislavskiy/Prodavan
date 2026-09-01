import { showCrmToast } from '../crmToast'
import { ApiError, apiRequest } from './apiClient'

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

const TASK_EDIT_ERROR = 'Не удалось сохранить изменения. Попробуйте позже.'
const TASK_CONFLICT_ERROR = 'Задача была изменена другим пользователем. Обновите данные.'

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
  return createUuidV4()
}

export async function updateTask(
  taskId: string,
  data: UpdateTaskRequest,
  signal?: AbortSignal,
) {
  try {
    return await apiRequest<ApiTaskDetail>(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: data,
      signal,
    })
  } catch (error) {
    showTaskMutationError(error)
    throw error
  }
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  version: number,
  signal?: AbortSignal,
) {
  try {
    return await apiRequest<ApiTaskDetail>(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: {
        status,
        version,
      },
      signal,
    })
  } catch (error) {
    showTaskMutationError(error)
    throw error
  }
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

function showTaskMutationError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return

  showCrmToast(
    error instanceof ApiError && error.status === 409
      ? TASK_CONFLICT_ERROR
      : TASK_EDIT_ERROR,
  )
}

function createUuidV4() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
