import { apiRequest } from './apiClient'

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

export function getAiSettings() {
  return apiRequest<ApiAiSettings>('/api/ai/settings')
}

export function updateAiSettings(payload: UpdateAiSettingsPayload) {
  return apiRequest<ApiAiSettings>('/api/ai/settings', {
    method: 'PATCH',
    body: payload,
  })
}

export function getKnowledgeFiles(page = 1, pageSize = 50) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })

  return apiRequest<ApiKnowledgeFilesResponse>(`/api/ai/knowledge-base/files?${params.toString()}`)
}
