import { showCrmToast } from '../crmToast'
import { ApiError, apiRequest } from './apiClient'

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
  company?: Partial<ApiCompanySettings>
}

type TelegramSettingsResponse = {
  integration: ApiWorkspaceIntegration
}

type TelegramMutationResponse = TelegramSettingsResponse & {
  message: string
}

const SETTINGS_CONFLICT_MESSAGE =
  'Настройки были изменены другим пользователем. Обновите страницу и повторите попытку.'

export function getWorkspaceSettings(signal?: AbortSignal) {
  return apiRequest<ApiWorkspaceSettings>('/api/workspace/settings', { signal })
}

export async function updateWorkspaceSettings(
  payload: UpdateWorkspaceSettingsPayload,
  idempotencyKey: string = crypto.randomUUID(),
  signal?: AbortSignal,
) {
  try {
    const settings = await apiRequest<ApiWorkspaceSettings>('/api/workspace/settings', {
      method: 'PATCH',
      headers: {
        'If-Match': `"${payload.version}"`,
        'Idempotency-Key': idempotencyKey,
      },
      body: payload,
      signal,
      suppressGlobalErrorToast: true,
    })
    showCrmToast({ kind: 'success', message: 'Настройки сохранены' })
    return settings
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      showCrmToast({
        kind: 'error',
        message:
          error instanceof ApiError && error.status === 409
            ? SETTINGS_CONFLICT_MESSAGE
            : error instanceof Error
              ? error.message
              : 'Не удалось сохранить настройки.',
      })
    }
    throw error
  }
}

export function getTelegramSettings(signal?: AbortSignal) {
  return apiRequest<TelegramSettingsResponse>('/api/settings/integrations/telegram', {
    signal,
  })
}

export function connectTelegram(botToken: string, signal?: AbortSignal) {
  return apiRequest<TelegramMutationResponse>('/api/settings/integrations/telegram/connect', {
    method: 'POST',
    body: { bot_token: botToken },
    signal,
  })
}

export function disconnectTelegram(signal?: AbortSignal) {
  return apiRequest<TelegramMutationResponse>('/api/settings/integrations/telegram/disconnect', {
    method: 'POST',
    signal,
  })
}
