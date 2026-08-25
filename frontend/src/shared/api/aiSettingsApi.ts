import { ApiError, apiRequest } from './apiClient'

export type ApiAutopilotMode = 'always' | 'fallback'

export type ApiAiSettingsLimits = {
  daily_deal_creation: number
  daily_task_creation: number
  daily_contact_updates: number
  daily_autopilot_replies: number
  hourly_auto_replies_per_chat: number
  max_consecutive_ai_replies: number
  tasks_per_chat_24h: number
}

export type ApiAiSettingsCurrentUsage = {
  deals_today: number
  tasks_today: number
  updates_today: number
  autopilot_replies_today: number
}

export type ApiAiSettings = {
  version: number
  instruction: string
  autopilot_enabled: boolean
  autopilot_mode: ApiAutopilotMode
  autopilot_delay: number
  limits: ApiAiSettingsLimits
  current_usage: ApiAiSettingsCurrentUsage
}

export type UpdateAiSettingsPayload = {
  version: number
  instruction?: string
  autopilot_enabled?: boolean
  autopilot_mode?: ApiAutopilotMode
  autopilot_delay?: number
}

export type ApiKnowledgeDocumentStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export type ApiKnowledgeDocument = {
  id: string
  name: string
  size: number
  mime_type: string
  status: ApiKnowledgeDocumentStatus
  error_reason: string
  processing_attempts: number
  uploaded_at: string
  processed_at: string | null
}

export type ApiKnowledgeStorage = {
  used_bytes: number
  limit_bytes: number
  files_count: number
  files_limit: number
}

export type ApiKnowledgeFilesResponse = {
  files: ApiKnowledgeDocument[]
  total: number
  page: number
  page_size: number
  storage: ApiKnowledgeStorage
}

export type ApiKnowledgeFilesUploadResponse = {
  files: ApiKnowledgeDocument[]
  accepted: number
}

const SETTINGS_TIMEOUT_MS = 10_000
const SETTINGS_LOAD_ERROR = 'Не удалось загрузить настройки. Обновите страницу.'
const INSTRUCTION_SAVE_ERROR = 'Не удалось сохранить инструкцию. Попробуйте позже.'
const SETTINGS_CONFLICT_ERROR = 'Настройки были изменены другим пользователем или в другой вкладке. Обновите страницу.'
const AUTOPILOT_SAVE_ERROR = 'Не удалось изменить состояние автопилота. Попробуйте позже.'
const KNOWLEDGE_LIST_ERROR = 'Не удалось загрузить список документов. Обновите страницу.'
const KNOWLEDGE_UPLOAD_ERROR = 'Не удалось загрузить файл. Попробуйте позже.'
const KNOWLEDGE_DELETE_ERROR = 'Не удалось удалить файл. Попробуйте позже.'
const KNOWLEDGE_RETRY_ERROR = 'Не удалось повторить обработку документа. Попробуйте позже.'

export async function getAiSettings() {
  try {
    return await withTimeout(
      (signal) => apiRequest<ApiAiSettings>('/api/ai/settings', { signal }),
      SETTINGS_TIMEOUT_MS,
    )
  } catch (error) {
    throw normalizeServerError(error, SETTINGS_LOAD_ERROR)
  }
}

export async function updateAiSettings(payload: UpdateAiSettingsPayload) {
  try {
    return await withTimeout(
      (signal) => apiRequest<ApiAiSettings>('/api/ai/settings', {
        method: 'PATCH',
        body: payload,
        signal,
      }),
      SETTINGS_TIMEOUT_MS,
    )
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new Error(SETTINGS_CONFLICT_ERROR)
    }

    const updatesInstruction = Object.prototype.hasOwnProperty.call(payload, 'instruction')
    const updatesAutopilot = Object.prototype.hasOwnProperty.call(payload, 'autopilot_enabled')
      || Object.prototype.hasOwnProperty.call(payload, 'autopilot_mode')
      || Object.prototype.hasOwnProperty.call(payload, 'autopilot_delay')

    if (updatesInstruction && !updatesAutopilot) {
      throw normalizeServerError(error, INSTRUCTION_SAVE_ERROR)
    }

    if (updatesAutopilot && !updatesInstruction) {
      throw normalizeServerError(error, AUTOPILOT_SAVE_ERROR)
    }

    throw normalizeServerError(error, 'Не удалось сбросить настройки. Попробуйте позже.')
  }
}

export async function getKnowledgeFiles(page = 1, pageSize = 50) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })

  try {
    return await apiRequest<ApiKnowledgeFilesResponse>(
      `/api/ai/knowledge-base/files?${params.toString()}`,
    )
  } catch (error) {
    throw normalizeServerError(error, KNOWLEDGE_LIST_ERROR)
  }
}

export async function uploadKnowledgeFiles(files: File[]) {
  const formData = new FormData()

  files.forEach((file) => {
    formData.append('files', file)
  })

  try {
    return await apiRequest<ApiKnowledgeFilesUploadResponse>('/api/ai/knowledge-base/files', {
      method: 'POST',
      body: formData,
    })
  } catch (error) {
    throw normalizeServerError(error, KNOWLEDGE_UPLOAD_ERROR)
  }
}

export async function retryKnowledgeFile(documentId: string) {
  try {
    return await apiRequest<ApiKnowledgeDocument>(
      `/api/ai/knowledge-base/files/${encodeURIComponent(documentId)}/retry`,
      {
        method: 'POST',
      },
    )
  } catch (error) {
    throw normalizeServerError(error, KNOWLEDGE_RETRY_ERROR)
  }
}

export async function deleteKnowledgeFile(documentId: string) {
  try {
    return await apiRequest<null>(`/api/ai/knowledge-base/files/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
    })
  } catch (error) {
    throw normalizeServerError(error, KNOWLEDGE_DELETE_ERROR)
  }
}

async function withTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await request(controller.signal)
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function normalizeServerError(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError && error.status < 500) {
    return error
  }

  return new Error(fallbackMessage)
}
