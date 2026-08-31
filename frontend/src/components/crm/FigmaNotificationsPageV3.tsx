import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteAllNotifications,
  deleteNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type ApiNotification,
  type NotificationRealtimeEnvelope,
} from '../../shared/api/notificationsApi'
import { showCrmToast } from '../../shared/crmToast'
import './FigmaNotificationsPageContract.css'

type FigmaNotificationsPageProps = {
  unreadCount: number
  realtimeEnvelope: NotificationRealtimeEnvelope | null
  onUnreadCountChange: (count: number) => void
  onNavigate: (href: string) => void
}

type PageState = 'loading' | 'ready' | 'error'
type ConfirmState =
  | { kind: 'one'; notification: ApiNotification }
  | { kind: 'all' }
  | null

const PAGE_SIZE = 50
const TEMPORARY_UNAVAILABLE = 'Сервер временно недоступен. Попробуйте позже.'

export function FigmaNotificationsPage({
  unreadCount,
  realtimeEnvelope,
  onUnreadCountChange,
  onNavigate,
}: FigmaNotificationsPageProps) {
  const [pageState, setPageState] = useState<PageState>('loading')
  const [notifications, setNotifications] = useState<ApiNotification[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [isBulkBusy, setIsBulkBusy] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState>(null)

  const initialControllerRef = useRef<AbortController | null>(null)
  const pageControllerRef = useRef<AbortController | null>(null)
  const actionControllerRef = useRef<AbortController | null>(null)
  const metadataControllerRef = useRef<AbortController | null>(null)
  const seenRealtimeSequenceRef = useRef(realtimeEnvelope?.sequence ?? 0)

  const loadInitial = useCallback(async () => {
    initialControllerRef.current?.abort()
    const controller = new AbortController()
    initialControllerRef.current = controller
    setPageState('loading')

    try {
      const response = await getNotifications(PAGE_SIZE, null, controller.signal)
      if (controller.signal.aborted) {
        return
      }

      setNotifications(response.notifications)
      setNextCursor(response.next_cursor)
      setHasMore(response.has_more)
      setPageState('ready')
    } catch (error) {
      if (!isAbortError(error)) {
        setPageState('error')
      }
    } finally {
      if (initialControllerRef.current === controller) {
        initialControllerRef.current = null
      }
    }
  }, [])

  const refreshPaginationMetadata = useCallback(async () => {
    metadataControllerRef.current?.abort()
    const controller = new AbortController()
    metadataControllerRef.current = controller

    try {
      const response = await getNotifications(PAGE_SIZE, null, controller.signal)
      if (!controller.signal.aborted) {
        setNextCursor(response.next_cursor)
        setHasMore(response.has_more)
      }
    } catch (error) {
      if (!isAbortError(error)) {
        // The visible list is already correct. Pagination metadata can be
        // reconciled by the next page refresh/reopen if this background call fails.
      }
    } finally {
      if (metadataControllerRef.current === controller) {
        metadataControllerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    void loadInitial()
    return () => {
      initialControllerRef.current?.abort()
      pageControllerRef.current?.abort()
      actionControllerRef.current?.abort()
      metadataControllerRef.current?.abort()
    }
  }, [loadInitial])

  useEffect(() => {
    if (!realtimeEnvelope || pageState !== 'ready') {
      return
    }

    if (realtimeEnvelope.sequence <= seenRealtimeSequenceRef.current) {
      return
    }
    seenRealtimeSequenceRef.current = realtimeEnvelope.sequence

    const { event } = realtimeEnvelope

    if (event.event === 'notification_created') {
      const notification = parseNotification(event.payload)
      if (!notification) {
        return
      }

      const shouldTrimToFirstPage = notifications.length === PAGE_SIZE
      setNotifications((current) => {
        if (current.some((item) => item.id === notification.id)) {
          return current
        }

        const next = [notification, ...current]
        return shouldTrimToFirstPage ? next.slice(0, PAGE_SIZE) : next
      })

      if (shouldTrimToFirstPage) {
        // The visible update is immediate and local. Only refresh the opaque
        // cursor in the background so the removed 50th item is not skipped when
        // the user presses "Загрузить ещё".
        void refreshPaginationMetadata()
      }
      return
    }

    if (event.event === 'notification_updated') {
      const notification = parseNotification(event.payload)
      if (!notification) {
        return
      }
      setNotifications((current) => current.map((item) =>
        item.id === notification.id ? notification : item,
      ))
      return
    }

    if (event.event === 'notification_read') {
      const payload = parseReadPayload(event.payload)
      if (!payload) {
        return
      }
      setNotifications((current) => current.map((item) =>
        item.id === payload.id
          ? { ...item, is_read: true, read_at: payload.read_at }
          : item,
      ))
      return
    }

    if (event.event === 'notification_deleted') {
      const id = parseIdPayload(event.payload)
      if (!id) {
        return
      }
      setNotifications((current) => current.filter((item) => item.id !== id))
      setConfirmState((current) =>
        current?.kind === 'one' && current.notification.id === id ? null : current,
      )
      return
    }

    if (event.event === 'notifications_deleted') {
      setNotifications([])
      setNextCursor(null)
      setHasMore(false)
      setConfirmState(null)
    }
  }, [
    notifications.length,
    pageState,
    realtimeEnvelope,
    refreshPaginationMetadata,
  ])

  const setBusy = (id: string, value: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current)
      if (value) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const markRead = async (notification: ApiNotification) => {
    if (notification.is_read || busyIds.has(notification.id) || isBulkBusy) {
      return notification
    }

    const controller = new AbortController()
    actionControllerRef.current?.abort()
    actionControllerRef.current = controller
    setBusy(notification.id, true)

    try {
      const response = await markNotificationRead(notification.id, controller.signal)
      if (controller.signal.aborted) {
        return null
      }

      setNotifications((current) => current.map((item) =>
        item.id === notification.id ? response.notification : item,
      ))
      onUnreadCountChange(Math.max(0, unreadCount - 1))
      return response.notification
    } catch (error) {
      if (!isAbortError(error)) {
        showCrmToast(actionErrorMessage(error, 'Ошибка обновления статуса. Попробуйте позже.'))
      }
      return null
    } finally {
      if (actionControllerRef.current === controller) {
        actionControllerRef.current = null
      }
      setBusy(notification.id, false)
    }
  }

  const openNotification = async (notification: ApiNotification) => {
    const current = notification.is_read ? notification : await markRead(notification)
    if (!current) {
      return
    }

    const href = notificationHref(current)
    if (!href || sameLocation(href)) {
      return
    }
    onNavigate(href)
  }

  const markAllRead = async () => {
    if (isBulkBusy || unreadCount === 0) {
      return
    }

    const controller = new AbortController()
    actionControllerRef.current?.abort()
    actionControllerRef.current = controller
    setIsBulkBusy(true)

    try {
      await markAllNotificationsRead(controller.signal)
      if (controller.signal.aborted) {
        return
      }
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((item) =>
        item.is_read ? item : { ...item, is_read: true, read_at: readAt },
      ))
      onUnreadCountChange(0)
    } catch (error) {
      if (!isAbortError(error)) {
        showCrmToast(actionErrorMessage(error, 'Ошибка обновления статуса. Попробуйте позже.'))
      }
    } finally {
      if (actionControllerRef.current === controller) {
        actionControllerRef.current = null
      }
      setIsBulkBusy(false)
    }
  }

  const confirmDelete = async () => {
    const target = confirmState
    if (!target || isBulkBusy) {
      return
    }

    const controller = new AbortController()
    actionControllerRef.current?.abort()
    actionControllerRef.current = controller
    setIsBulkBusy(true)

    try {
      if (target.kind === 'all') {
        await deleteAllNotifications(controller.signal)
        if (controller.signal.aborted) {
          return
        }
        setNotifications([])
        setNextCursor(null)
        setHasMore(false)
        onUnreadCountChange(0)
      } else {
        await deleteNotification(target.notification.id, controller.signal)
        if (controller.signal.aborted) {
          return
        }
        setNotifications((current) => current.filter(
          (item) => item.id !== target.notification.id,
        ))
        if (!target.notification.is_read) {
          onUnreadCountChange(Math.max(0, unreadCount - 1))
        }
      }
      setConfirmState(null)
    } catch (error) {
      if (!isAbortError(error)) {
        showCrmToast(actionErrorMessage(error, 'Не удалось удалить уведомление. Попробуйте позже.'))
      }
    } finally {
      if (actionControllerRef.current === controller) {
        actionControllerRef.current = null
      }
      setIsBulkBusy(false)
    }
  }

  const loadMore = async () => {
    if (!hasMore || !nextCursor || isLoadingMore) {
      return
    }

    pageControllerRef.current?.abort()
    const controller = new AbortController()
    pageControllerRef.current = controller
    setIsLoadingMore(true)

    try {
      const response = await getNotifications(PAGE_SIZE, nextCursor, controller.signal)
      if (controller.signal.aborted) {
        return
      }

      setNotifications((current) => {
        const ids = new Set(current.map((item) => item.id))
        return [
          ...current,
          ...response.notifications.filter((item) => !ids.has(item.id)),
        ]
      })
      setNextCursor(response.next_cursor)
      setHasMore(response.has_more)
    } catch (error) {
      if (!isAbortError(error)) {
        showCrmToast(actionErrorMessage(error, 'Не удалось загрузить уведомления'))
      }
    } finally {
      if (pageControllerRef.current === controller) {
        pageControllerRef.current = null
      }
      setIsLoadingMore(false)
    }
  }

  return (
    <section className="figma-notifications-page notifications-contract" aria-label="Уведомления">
      <header className="notifications-contract__header">
        <div>
          <h1>Уведомления</h1>
          <p>Непрочитанных: {unreadCount}</p>
        </div>
        <div className="notifications-contract__header-actions">
          <button
            type="button"
            disabled={isBulkBusy || unreadCount === 0}
            onClick={() => void markAllRead()}
          >
            Отметить все как прочитанные
          </button>
          <button
            type="button"
            disabled={isBulkBusy || notifications.length === 0}
            onClick={() => setConfirmState({ kind: 'all' })}
          >
            Удалить все уведомления
          </button>
        </div>
      </header>

      {pageState === 'loading' && <NotificationSkeleton />}

      {pageState === 'error' && (
        <div className="notifications-contract__state" role="alert">
          <p>Не удалось загрузить уведомления</p>
          <button type="button" onClick={() => void loadInitial()}>
            Повторить
          </button>
        </div>
      )}

      {pageState === 'ready' && notifications.length === 0 && (
        <div className="notifications-contract__state">
          <p>У вас пока нет уведомлений</p>
        </div>
      )}

      {pageState === 'ready' && notifications.length > 0 && (
        <div className="notifications-contract__list">
          {notifications.map((notification) => {
            const isBusy = busyIds.has(notification.id)
            return (
              <article
                className={`notifications-contract__item${
                  notification.is_read ? '' : ' notifications-contract__item--unread'
                }`}
                key={notification.id}
              >
                <button
                  className="notifications-contract__content"
                  type="button"
                  disabled={isBusy || isBulkBusy}
                  onClick={() => void openNotification(notification)}
                >
                  <span className="notifications-contract__topline">
                    <strong>{notification.title}</strong>
                    <time>{formatNotificationDate(notification.created_at)}</time>
                  </span>
                  <span className="notifications-contract__category">
                    {notificationCategory(notification)}
                  </span>
                  <span className="notifications-contract__text">
                    {notification.content}
                  </span>
                  {notificationHref(notification) && (
                    <span className="notifications-contract__link">Открыть</span>
                  )}
                </button>

                <div className="notifications-contract__item-actions">
                  {!notification.is_read && (
                    <button
                      type="button"
                      disabled={isBusy || isBulkBusy}
                      onClick={() => void markRead(notification)}
                    >
                      Отметить как прочитанное
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isBusy || isBulkBusy}
                    aria-label={`Удалить уведомление «${notification.title}»`}
                    onClick={() => setConfirmState({ kind: 'one', notification })}
                  >
                    Удалить
                  </button>
                </div>
              </article>
            )
          })}

          {hasMore && (
            <button
              className="notifications-contract__load-more"
              type="button"
              disabled={isLoadingMore}
              onClick={() => void loadMore()}
            >
              {isLoadingMore ? 'Загрузка…' : 'Загрузить ещё'}
            </button>
          )}
        </div>
      )}

      {confirmState && (
        <div className="notifications-contract__confirm-backdrop" role="presentation">
          <div className="notifications-contract__confirm" role="alertdialog" aria-modal="true">
            <p>
              {confirmState.kind === 'all'
                ? 'Удалить все уведомления? Они будут скрыты, но сохранятся в системе для аудита'
                : 'Вы уверены, что хотите удалить уведомление?'}
            </p>
            <div>
              <button
                type="button"
                disabled={isBulkBusy}
                onClick={() => setConfirmState(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isBulkBusy}
                onClick={() => void confirmDelete()}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function NotificationSkeleton() {
  return (
    <div className="notifications-contract__skeleton" role="status" aria-label="Загрузка уведомлений">
      {[1, 2, 3, 4, 5].map((item) => (
        <div key={item}>
          <span />
          <i />
          <i />
        </div>
      ))}
    </div>
  )
}

function parseNotification(payload: unknown): ApiNotification | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const value = payload as Partial<ApiNotification>
  if (
    typeof value.id !== 'string'
    || typeof value.type !== 'string'
    || typeof value.title !== 'string'
    || typeof value.content !== 'string'
    || typeof value.link !== 'string'
    || typeof value.entity_type !== 'string'
    || typeof value.entity_id !== 'string'
    || typeof value.is_read !== 'boolean'
    || typeof value.created_at !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    type: value.type,
    title: value.title,
    content: value.content,
    link: value.link,
    entity_type: value.entity_type,
    entity_id: value.entity_id,
    is_read: value.is_read,
    read_at: typeof value.read_at === 'string' ? value.read_at : null,
    is_deleted: value.is_deleted === true,
    deleted_at: typeof value.deleted_at === 'string' ? value.deleted_at : null,
    created_at: value.created_at,
  }
}

function parseReadPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const value = payload as { id?: unknown; read_at?: unknown }
  return typeof value.id === 'string' && typeof value.read_at === 'string'
    ? { id: value.id, read_at: value.read_at }
    : null
}

function parseIdPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const id = (payload as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

function notificationHref(notification: ApiNotification) {
  const explicit = notification.link.trim()
  if (explicit) {
    return explicit
  }

  const id = notification.entity_id.trim()
  if (!id) {
    return ''
  }

  if (notification.entity_type === 'chat') return `/chat/${id}`
  if (notification.entity_type === 'deal') return `/deals/${id}`
  if (notification.entity_type === 'contact') return `/contacts/${id}`
  if (notification.entity_type === 'task') return `/tasks/${id}`
  return ''
}

function sameLocation(href: string) {
  try {
    const target = new URL(href, window.location.origin)
    return (
      target.origin === window.location.origin
      && target.pathname === window.location.pathname
      && target.search === window.location.search
      && target.hash === window.location.hash
    )
  } catch {
    return false
  }
}

function notificationCategory(notification: ApiNotification) {
  const value = `${notification.type} ${notification.entity_type}`.toLowerCase()
  if (value.includes('task')) return 'Задача'
  if (value.includes('deal')) return 'Сделка'
  if (value.includes('contact')) return 'Контакт'
  if (value.includes('chat') || value.includes('message') || value.includes('telegram')) return 'Чат'
  if (value.includes('ai')) return 'AI'
  return 'Система'
}

function formatNotificationDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const now = new Date()
  const sameDay = (
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  )
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)

  if (sameDay) {
    return `сегодня, ${time}`
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function actionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === 'Сервер не отвечает. Попробуйте позже.') {
    return TEMPORARY_UNAVAILABLE
  }
  return fallback
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
