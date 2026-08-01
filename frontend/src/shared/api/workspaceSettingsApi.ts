import { apiRequest } from './apiClient'

export type ApiIntegrationStatus = 'connected' | 'disconnected'
export type ApiIntegrationHealth = 'healthy' | 'degraded' | 'error' | null

export type ApiWorkspaceIntegration = {
  type: string
  status: ApiIntegrationStatus
  health_status: ApiIntegrationHealth
  bot_username: string
  connected_at: string | null
  last_check_at: string | null
  last_error: string
  webhook_configured: boolean
}

export type ApiCompanySettings = {
  full_name: string
  short_name: string | null
  legal_address: string | null
  postal_address: string | null
  inn: string | null
  kpp: string | null
  ogrn: string | null
  okved: string | null
  okpo: string | null
}

export type ApiWorkspaceSettings = {
  version: number
  timezone: string
  language: string
  company: ApiCompanySettings
  integrations: ApiWorkspaceIntegration[]
}

export type UpdateWorkspaceSettingsPayload = {
  version: number
  timezone?: string
  company?: ApiCompanySettings
}

type TelegramSettingsResponse = {
  integration: ApiWorkspaceIntegration
}

type TelegramMutationResponse = TelegramSettingsResponse & {
  message: string
}

export function getWorkspaceSettings() {
  return apiRequest<ApiWorkspaceSettings>('/api/workspace/settings')
}

export function updateWorkspaceSettings(payload: UpdateWorkspaceSettingsPayload) {
  return apiRequest<ApiWorkspaceSettings>('/api/workspace/settings', {
    method: 'PATCH',
    headers: {
      'If-Match': `"${payload.version}"`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: payload,
  })
}

export function getTelegramSettings() {
  return apiRequest<TelegramSettingsResponse>('/api/settings/integrations/telegram')
}

export function connectTelegram(botToken: string) {
  return apiRequest<TelegramMutationResponse>('/api/settings/integrations/telegram/connect', {
    method: 'POST',
    body: { bot_token: botToken },
  })
}

export function disconnectTelegram() {
  return apiRequest<TelegramMutationResponse>('/api/settings/integrations/telegram/disconnect', {
    method: 'POST',
  })
}
