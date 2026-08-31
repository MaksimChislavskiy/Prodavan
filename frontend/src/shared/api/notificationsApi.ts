import { apiRequest } from './apiClient'
import { getAccessToken } from './authToken'

export type ApiNotification = {
  id: string
  type: string
  title: string
  content: string
  link: string
  entity_type: string
  entity_id: string
  is_read: boolean
  read_at: string | null
  is_deleted: boolean
  deleted_at: string | null
  created_at: string
}

export type NotificationsPageResponse = {
  notifications: ApiNotification[]
  next_cursor: string | null
  has_more: boolean
}

export type NotificationRealtimeEvent = {
  event: string
  payload?: unknown
}

export type NotificationRealtimeEnvelope = {
  sequence: number
  event: NotificationRealtimeEvent
}

type UnreadCountResponse = {
  unread_count: number
}

type MarkNotificationReadResponse = {
  notification: ApiNotification
}

type MarkAllNotificationsReadResponse = {
  updated: number
  unread_count: number
}

type DeleteAllNotificationsResponse = {
  deleted_count: number
}

const NOTIFICATIONS_REQUEST_TIMEOUT_MS = 10_000

export function getNotifications(
  limit = 50,
  cursor?: string | null,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams({ limit: String(limit) })

  if (cursor) {
    searchParams.set('cursor', cursor)
  }

  return apiRequest<NotificationsPageResponse>(
    `/api/notifications?${searchParams.toString()}`,
    {
      signal,
      timeoutMs: NOTIFICATIONS_REQUEST_TIMEOUT_MS,
    },
  )
}

export function getNotificationUnreadCount(signal?: AbortSignal) {
  return apiRequest<UnreadCountResponse>('/api/notifications/unread-count', {
    signal,
    timeoutMs: NOTIFICATIONS_REQUEST_TIMEOUT_MS,
  })
}

export function markNotificationRead(
  notificationId: string,
  signal?: AbortSignal,
) {
  return apiRequest<MarkNotificationReadResponse>(
    `/api/notifications/${notificationId}/read`,
    {
      method: 'PATCH',
      signal,
      timeoutMs: NOTIFICATIONS_REQUEST_TIMEOUT_MS,
    },
  )
}

export function markAllNotificationsRead(signal?: AbortSignal) {
  return apiRequest<MarkAllNotificationsReadResponse>(
    '/api/notifications/mark-all-read',
    {
      method: 'POST',
      signal,
      timeoutMs: NOTIFICATIONS_REQUEST_TIMEOUT_MS,
    },
  )
}

export function deleteNotification(
  notificationId: string,
  signal?: AbortSignal,
) {
  return apiRequest<null>(`/api/notifications/${notificationId}`, {
    method: 'DELETE',
    signal,
    timeoutMs: NOTIFICATIONS_REQUEST_TIMEOUT_MS,
  })
}

export function deleteAllNotifications(signal?: AbortSignal) {
  return apiRequest<DeleteAllNotificationsResponse>('/api/notifications/all', {
    method: 'DELETE',
    signal,
    timeoutMs: NOTIFICATIONS_REQUEST_TIMEOUT_MS,
  })
}

export function createNotificationsSocket() {
  const token = getAccessToken()

  if (!token) {
    return null
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

  return new WebSocket(
    `${protocol}//${window.location.host}/ws/notifications`,
    ['Bearer', token],
  )
}
