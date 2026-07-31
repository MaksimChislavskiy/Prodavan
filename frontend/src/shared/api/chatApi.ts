import { apiRequest } from './apiClient'
import { getAccessToken } from './authToken'

export type ApiChatContact = {
  id: string
  name: string
  company: string | null
  is_deleted: boolean
}

export type ApiChat = {
  id: string
  contact: ApiChatContact
  last_message: string
  last_message_at: string | null
  unread_count: number
  ai_autopilot_enabled: boolean | null
}

export type ApiChatMessage = {
  id: string
  chat_id: string
  sender_type: 'user' | 'contact'
  sender_id: string | null
  text: string
  status: 'sent' | 'delivered' | 'failed' | null
  read_at: string | null
  sent_by_ai: boolean
  created_at: string
}

export type ApiChatsResponse = {
  chats: ApiChat[]
  page: number
  limit: number
  total: number
}

export type ApiMessagesResponse = {
  messages: ApiChatMessage[]
  next_cursor: string | null
  has_more: boolean
}

export type ChatSocketEvent =
  | { event: 'chat_created'; chat: ApiChat }
  | { event: 'message_new'; chat_id: string; message: ApiChatMessage }
  | { event: 'message_read'; chat_id: string; read_at: string }
  | {
      event: 'message_status_updated'
      chat_id: string
      message_id: string
      status: 'sent' | 'delivered' | 'failed'
    }
  | { event: 'error'; code: string; message: string }

export function getChats(signal?: AbortSignal) {
  return apiRequest<ApiChatsResponse>('/api/chats?limit=100', { signal })
}

export function getChatMessages(
  chatId: string,
  cursor?: string | null,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams({ limit: '50' })
  if (cursor) searchParams.set('cursor', cursor)

  return apiRequest<ApiMessagesResponse>(
    `/api/chats/${chatId}/messages?${searchParams.toString()}`,
    { signal },
  )
}

export function sendChatMessage(
  chatId: string,
  text: string,
  idempotencyKey: string,
) {
  return apiRequest<ApiChatMessage>(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: { text },
  })
}

export function markChatRead(chatId: string) {
  return apiRequest<void>(`/api/chats/${chatId}/read`, { method: 'POST' })
}

export function deleteChat(chatId: string) {
  return apiRequest<void>(`/api/chats/${chatId}`, { method: 'DELETE' })
}

export function createChatSocket() {
  const token = getAccessToken()
  if (!token) return null

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(
    `${protocol}//${window.location.host}/ws/chat?token=${encodeURIComponent(token)}`,
  )
}
