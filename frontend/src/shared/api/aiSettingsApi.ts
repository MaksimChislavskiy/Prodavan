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

export function getAiSettings() {
  return apiRequest<ApiAiSettings>('/api/ai/settings')
}
