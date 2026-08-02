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
    { signal },
  )
}

export function getNotificationUnreadCount(signal?: AbortSignal) {
  return apiRequest<UnreadCountResponse>('/api/notifications/unread-count', {
    signal,
  })
}

export function markNotificationRead(notificationId: string) {
  return apiRequest<MarkNotificationReadResponse>(
    `/api/notifications/${notificationId}/read`,
    { method: 'PATCH' },
  )
}

export function markAllNotificationsRead() {
  return apiRequest<MarkAllNotificationsReadResponse>(
    '/api/notifications/mark-all-read',
    { method: 'POST' },
  )
}

export function deleteNotification(notificationId: string) {
  return apiRequest<null>(`/api/notifications/${notificationId}`, {
    method: 'DELETE',
  })
}

export function deleteAllNotifications() {
  return apiRequest<DeleteAllNotificationsResponse>('/api/notifications/all', {
    method: 'DELETE',
  })
}

export function createNotificationsSocket() {
  const token = getAccessToken()

  if (!token) {
    return null
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const encodedToken = encodeURIComponent(token)

  return new WebSocket(
    `${protocol}//${window.location.host}/ws/notifications?token=${encodedToken}`,
  )
}
