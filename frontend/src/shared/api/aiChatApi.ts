import { apiRequest } from './apiClient'

export type AiChatContext = {
  page: 'dashboard' | 'deals' | 'contacts' | 'tasks' | 'chat' | 'reports' | 'settings'
  entity_id: string | null
}

export type ApiAiChatSessionResponse = {
  session_id: string
  created_at: string
}

export type ApiAiChatMessage = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  status: 'pending' | 'streaming' | 'success' | 'failed' | 'timeout'
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

export function createAiChatSession(context: AiChatContext) {
  return apiRequest<ApiAiChatSessionResponse>('/api/ai/chat/session', {
    method: 'POST',
    body: {
      context,
    },
  })
}

export function getAiChatHistory(limit = 20) {
  return apiRequest<ApiAiChatHistoryResponse>(`/api/ai/chat/history?limit=${limit}`)
}

export function sendAiChatMessage(params: {
  sessionId: string
  message: string
  context: AiChatContext
}) {
  return apiRequest<ApiAiChatResponse>('/api/ai/chat', {
    method: 'POST',
    body: {
      client_message_id: crypto.randomUUID(),
      message: params.message,
      context: params.context,
      session_id: params.sessionId,
    },
  })
}