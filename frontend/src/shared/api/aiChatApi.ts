import { clearPendingAiQuery, rememberPendingAiQuery } from '../pendingAiQuery'
import { ApiError, apiRequest } from './apiClient'
import { getCurrentChatContextId } from './chatApi'

export type AiChatContext = {
  page: 'dashboard' | 'deals' | 'contacts' | 'tasks' | 'chat' | 'reports' | 'settings'
  entity_id: string | null
}

export type AiChatMessageStatus =
  | 'pending'
  | 'streaming'
  | 'success'
  | 'failed'
  | 'timeout'

export type ApiAiChatSessionResponse = {
  session_id: string
  created_at: string
}

export type ApiAiChatMessage = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  status: AiChatMessageStatus
  parent_message_id: string | null
  client_message_id: string | null
  created_at: string
  model_name: string | null
  provider: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  processing_time_ms: number | null
  error: string
  metadata: unknown
}

export type ApiAiChatResponse = {
  message: ApiAiChatMessage
}

export type ApiAiChatHistoryResponse = {
  messages: ApiAiChatMessage[]
  next_cursor: string | null
  has_more: boolean
}

export type ApiAiChatMessageStatusResponse = {
  id: string
  status: AiChatMessageStatus
  content: string
}

const OFFLINE_MESSAGE = 'Отсутствует подключение к интернету.'
const API_NETWORK_MESSAGE = 'Проверьте подключение к интернету'

let currentAiChatSessionId: string | null = null
const rememberedAiMessages = new Map<string, ApiAiChatMessage>()

export async function createAiChatSession(context: AiChatContext) {
  try {
    const response = await apiRequest<ApiAiChatSessionResponse>('/api/ai/chat/session', {
      method: 'POST',
      body: {
        context: resolveAiContext(context),
      },
      suppressGlobalErrorToast: true,
    })

    currentAiChatSessionId = response.session_id
    return response
  } catch (error) {
    throw normalizeNetworkError(error)
  }
}

export function getCurrentAiChatSessionId() {
  return currentAiChatSessionId
}

export async function closeCurrentAiChatSession() {
  const sessionId = currentAiChatSessionId

  if (!sessionId) {
    return
  }

  try {
    await apiRequest<null>(`/api/ai/chat/session/${sessionId}/close`, {
      method: 'POST',
    })
  } finally {
    if (currentAiChatSessionId === sessionId) {
      currentAiChatSessionId = null
    }
  }
}

export async function getAiChatHistory(limit = 20, cursor?: string | null) {
  const searchParams = new URLSearchParams({
    limit: String(limit),
  })

  if (cursor) {
    searchParams.set('cursor', cursor)
  }

  const response = await apiRequest<ApiAiChatHistoryResponse>(
    `/api/ai/chat/history?${searchParams.toString()}`,
  )
  response.messages.forEach(rememberAiMessage)
  return response
}

export async function sendAiChatMessage(params: {
  sessionId: string
  message: string
  context: AiChatContext
  clientMessageId?: string
}) {
  const clientMessageId = params.clientMessageId ?? crypto.randomUUID()
  const request = (sessionId: string) => requestAiChatMessage('/api/ai/chat', {
    client_message_id: clientMessageId,
    message: params.message,
    context: resolveAiContext(params.context),
    session_id: sessionId,
  })

  const initialSessionId = currentAiChatSessionId ?? params.sessionId

  try {
    const response = await request(initialSessionId)
    clearPendingAiQuery(params.message)
    return response
  } catch (error) {
    if (isSessionClosedError(error)) {
      try {
        const session = await createAiChatSession(params.context)
        const response = await request(session.session_id)
        clearPendingAiQuery(params.message)
        return response
      } catch (retryError) {
        throw handleSendFailure(retryError, params.message)
      }
    }

    throw handleSendFailure(error, params.message)
  }
}

export async function retryAiChatMessage(messageId: string) {
  return requestAiChatMessage('/api/ai/chat/retry', {
    message_id: messageId,
    retry_token: crypto.randomUUID(),
  })
}

export async function refreshAiChatMessage(messageId: string) {
  const response = await apiRequest<ApiAiChatMessageStatusResponse>(
    `/api/ai/chat/message/${messageId}`,
  )
  const remembered = rememberedAiMessages.get(messageId)

  if (remembered) {
    rememberedAiMessages.set(messageId, {
      ...remembered,
      status: response.status,
      content: response.content || remembered.content,
    })
  }

  return response
}

export function getRememberedAiChatMessage(messageId: string) {
  return rememberedAiMessages.get(messageId) ?? null
}

async function requestAiChatMessage(path: string, body: unknown) {
  try {
    const response = await apiRequest<ApiAiChatResponse>(path, {
      method: 'POST',
      body,
      suppressGlobalErrorToast: true,
    })
    rememberAiMessage(response.message)
    return response
  } catch (error) {
    const message = extractAiMessageFromError(error)
    if (!message) {
      throw error
    }

    rememberAiMessage(message)
    return { message }
  }
}

function rememberAiMessage(message: ApiAiChatMessage) {
  rememberedAiMessages.set(message.id, message)
}

function extractAiMessageFromError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return null
  }

  const data = error.data
  if (!data || typeof data !== 'object' || !('message' in data)) {
    return null
  }

  return isApiAiChatMessage(data.message) ? data.message : null
}

function isSessionClosedError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 403) {
    return false
  }

  const data = error.data
  if (!data || typeof data !== 'object' || !('error' in data)) {
    return false
  }

  const payload = data.error
  return Boolean(
    payload
    && typeof payload === 'object'
    && 'code' in payload
    && payload.code === 'SESSION_CLOSED',
  )
}

function handleSendFailure(error: unknown, message: string) {
  const normalizedError = normalizeNetworkError(error)
  if (normalizedError instanceof Error && normalizedError.message === OFFLINE_MESSAGE) {
    rememberPendingAiQuery(message)
  }
  return normalizedError
}

function normalizeNetworkError(error: unknown) {
  if (
    error instanceof Error
    && (
      error.message === API_NETWORK_MESSAGE
      || (typeof navigator !== 'undefined' && navigator.onLine === false)
    )
  ) {
    return new Error(OFFLINE_MESSAGE)
  }

  return error
}

function isApiAiChatMessage(value: unknown): value is ApiAiChatMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const message = value as Record<string, unknown>
  return (
    typeof message.id === 'string'
    && typeof message.session_id === 'string'
    && (message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string'
    && isAiChatMessageStatus(message.status)
    && (message.parent_message_id === null || typeof message.parent_message_id === 'string')
    && (message.client_message_id === null || typeof message.client_message_id === 'string')
    && typeof message.created_at === 'string'
  )
}

function isAiChatMessageStatus(value: unknown): value is AiChatMessageStatus {
  return (
    value === 'pending'
    || value === 'streaming'
    || value === 'success'
    || value === 'failed'
    || value === 'timeout'
  )
}

function resolveAiContext(context: AiChatContext): AiChatContext {
  if (context.page !== 'chat' || context.entity_id) {
    return context
  }

  return {
    ...context,
    entity_id: getCurrentChatContextId(),
  }
}
