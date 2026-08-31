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

export function getChatsPage(
  page = 1,
  limit = 20,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  })

  return apiRequest<ApiChatsResponse>(
    `/api/chats?${searchParams.toString()}`,
    { signal },
  )
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
  signal?: AbortSignal,
) {
  return apiRequest<ApiChatMessage>(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: { text },
    signal,
  })
}

export function markChatRead(chatId: string, signal?: AbortSignal) {
  return apiRequest<void>(`/api/chats/${chatId}/read`, {
    method: 'POST',
    signal,
  })
}

export function deleteChat(chatId: string, signal?: AbortSignal) {
  return apiRequest<void>(`/api/chats/${chatId}`, {
    method: 'DELETE',
    signal,
  })
}

export function createChatMessageIdempotencyKey() {
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

export function createChatSocket() {
  const token = getAccessToken()
  if (!token) return null

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(
    `${protocol}//${window.location.host}/ws/chat?token=${encodeURIComponent(token)}`,
  )
}
