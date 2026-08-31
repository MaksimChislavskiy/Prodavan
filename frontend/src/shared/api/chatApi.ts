import { ApiError, apiRequest } from './apiClient'
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

const CHAT_SOCKET_DEDUP_LIMIT = 1000
const seenSocketMessageIds = new Set<string>()
const seenSocketMessageOrder: string[] = []

export function getChats(signal?: AbortSignal) {
  return apiRequest<ApiChatsResponse>('/api/chats?limit=100', { signal })
}

export function getChat(chatId: string, signal?: AbortSignal) {
  return apiRequest<ApiChat>(`/api/chats/${chatId}`, { signal })
}

export async function getChatsPage(
  page = 1,
  limit = 20,
  signal?: AbortSignal,
) {
  const targetChatId = getDeepLinkedChatId()

  if (!targetChatId) {
    return requestChatsPage(page, limit, signal)
  }

  // ChatPageV2 normally selects the first row after the initial page is loaded.
  // For a notification deep link we expose the requested chat as a one-row
  // virtual first page. Subsequent virtual pages map to the ordinary sorted
  // server pages, so the selected chat remains active while the rest of the
  // list is filled normally and pagination stays available.
  if (page === 1) {
    const firstPagePromise = requestChatsPage(1, limit, signal)

    try {
      const [targetChat, firstPage] = await Promise.all([
        getChat(targetChatId, signal),
        firstPagePromise,
      ])

      return {
        chats: [targetChat],
        page: 1,
        limit,
        total: firstPage.total + limit,
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return firstPagePromise
      }
      throw error
    }
  }

  const response = await requestChatsPage(page - 1, limit, signal)

  return {
    chats: response.chats.filter((chat) => chat.id !== targetChatId),
    page,
    limit: response.limit,
    total: response.total + limit,
  }
}

function requestChatsPage(
  page: number,
  limit: number,
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

function getDeepLinkedChatId() {
  if (typeof window === 'undefined') {
    return null
  }

  const chatId = new URLSearchParams(window.location.search).get('chat_id')?.trim()
  return chatId || null
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
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/ws/chat`,
    ['Bearer', token],
  )

  // Section 12 requires message-id deduplication even across reconnects. Keep the
  // last 1000 incoming message_new ids at the transport boundary so duplicate WS
  // delivery cannot increment unread counters before page-level reconciliation.
  socket.addEventListener('message', (event) => {
    const messageId = getSocketMessageId(event.data)
    if (!messageId) {
      return
    }

    if (seenSocketMessageIds.has(messageId)) {
      event.stopImmediatePropagation()
      return
    }

    seenSocketMessageIds.add(messageId)
    seenSocketMessageOrder.push(messageId)

    while (seenSocketMessageOrder.length > CHAT_SOCKET_DEDUP_LIMIT) {
      const oldest = seenSocketMessageOrder.shift()
      if (oldest) {
        seenSocketMessageIds.delete(oldest)
      }
    }
  })

  return socket
}

function getSocketMessageId(rawData: unknown) {
  if (typeof rawData !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(rawData) as {
      event?: unknown
      message?: { id?: unknown }
    }
    return parsed.event === 'message_new' && typeof parsed.message?.id === 'string'
      ? parsed.message.id
      : null
  } catch {
    return null
  }
}
