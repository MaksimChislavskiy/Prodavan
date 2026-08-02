import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  createNotificationsSocket,
  getNotificationUnreadCount,
  type NotificationRealtimeEvent,
} from '../../shared/api/notificationsApi'
import { NotificationsPage } from './NotificationsPage'
import './NotificationsPage.css'

const NOTIFICATIONS_PATH = '/app/notifications'
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]

function isNotificationsPath(pathname: string) {
  return pathname === NOTIFICATIONS_PATH
}

function parseRealtimeEvent(value: string): NotificationRealtimeEvent | null {
  try {
    const parsed = JSON.parse(value) as unknown

    if (!parsed || typeof parsed !== 'object' || !('event' in parsed)) {
      return null
    }

    const event = (parsed as { event?: unknown }).event

    if (typeof event !== 'string') {
      return null
    }

    return parsed as NotificationRealtimeEvent
  } catch {
    return null
  }
}

function getUnreadCountFromEvent(event: NotificationRealtimeEvent) {
  if (event.event !== 'unread_count_updated') {
    return null
  }

  const payload = event.payload

  if (!payload || typeof payload !== 'object' || !('unread_count' in payload)) {
    return null
  }

  const unreadCount = (payload as { unread_count?: unknown }).unread_count

  return typeof unreadCount === 'number' ? Math.max(0, unreadCount) : null
}

export function NotificationCenterController() {
  const [isOpen, setIsOpen] = useState(() =>
    isNotificationsPath(window.location.pathname),
  )
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [realtimeVersion, setRealtimeVersion] = useState(0)

  const refreshUnreadCount = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await getNotificationUnreadCount(signal)
      setUnreadCount(Math.max(0, response.unread_count))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
    }
  }, [])

  const openNotifications = useCallback(() => {
    if (!isNotificationsPath(window.location.pathname)) {
      window.history.pushState(null, '', NOTIFICATIONS_PATH)
    }

    setIsOpen(true)
    window.scrollTo(0, 0)
  }, [])

  const navigateFromNotification = useCallback((href: string) => {
    const normalizedHref = href.trim()

    setIsOpen(false)

    if (!normalizedHref) {
      return
    }

    if (normalizedHref.startsWith('/')) {
      window.history.pushState(null, '', normalizedHref)
      window.dispatchEvent(new PopStateEvent('popstate'))
      return
    }

    window.location.assign(normalizedHref)
  }, [])

  useEffect(() => {
    const abortController = new AbortController()
    void refreshUnreadCount(abortController.signal)

    return () => abortController.abort()
  }, [refreshUnreadCount])

  useEffect(() => {
    let isDisposed = false
    let reconnectAttempt = 0
    let reconnectTimerId: number | null = null
    let socket: WebSocket | null = null

    const scheduleReconnect = () => {
      if (isDisposed) {
        return
      }

      const delay = RECONNECT_DELAYS[
        Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)
      ]
      reconnectAttempt += 1
      reconnectTimerId = window.setTimeout(connect, delay)
    }

    const connect = () => {
      if (isDisposed) {
        return
      }

      socket = createNotificationsSocket()

      if (!socket) {
        scheduleReconnect()
        return
      }

      socket.onopen = () => {
        reconnectAttempt = 0
        void refreshUnreadCount()
      }

      socket.onmessage = (messageEvent) => {
        if (typeof messageEvent.data !== 'string') {
          return
        }

        const event = parseRealtimeEvent(messageEvent.data)

        if (!event) {
          return
        }

        const nextUnreadCount = getUnreadCountFromEvent(event)

        if (nextUnreadCount !== null) {
          setUnreadCount(nextUnreadCount)
          setRealtimeVersion((version) => version + 1)
          return
        }

        setRealtimeVersion((version) => version + 1)
      }

      socket.onclose = () => {
        socket = null
        scheduleReconnect()
      }

      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()

    return () => {
      isDisposed = true

      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId)
      }

      socket?.close()
    }
  }, [refreshUnreadCount])

  useEffect(() => {
    let bellButton: HTMLButtonElement | null = null

    const applyBellState = () => {
      const nextBellButton = document.querySelector<HTMLButtonElement>(
        'button.crm-icon-button',
      )

      if (!nextBellButton) {
        return
      }

      if (bellButton !== nextBellButton) {
        bellButton?.removeEventListener('click', openNotifications)
        bellButton = nextBellButton
        bellButton.addEventListener('click', openNotifications)
      }

      bellButton.dataset.notificationCount =
        unreadCount > 99 ? '99+' : String(unreadCount)
      bellButton.dataset.hasNotifications = unreadCount > 0 ? 'true' : 'false'
      bellButton.setAttribute(
        'aria-label',
        unreadCount > 0
          ? `Уведомления: непрочитанных ${unreadCount}`
          : 'Уведомления: непрочитанных нет',
      )
    }

    applyBellState()

    const observer = new MutationObserver(applyBellState)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      bellButton?.removeEventListener('click', openNotifications)
    }
  }, [openNotifications, unreadCount])

  useEffect(() => {
    const syncPath = () => {
      setIsOpen(isNotificationsPath(window.location.pathname))
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      const link = target.closest<HTMLAnchorElement>('a[href]')

      if (!link || link.origin !== window.location.origin) {
        return
      }

      window.setTimeout(syncPath, 0)
    }

    window.addEventListener('popstate', syncPath)
    document.addEventListener('click', handleDocumentClick)

    return () => {
      window.removeEventListener('popstate', syncPath)
      document.removeEventListener('click', handleDocumentClick)
    }
  }, [])

  useEffect(() => {
    const target = document.querySelector<HTMLElement>('.crm-content')
    setPortalTarget(target)
  }, [])

  useEffect(() => {
    if (!portalTarget) {
      return
    }

    portalTarget.classList.toggle('crm-content--notification-center', isOpen)

    return () => {
      portalTarget.classList.remove('crm-content--notification-center')
    }
  }, [isOpen, portalTarget])

  if (!portalTarget || !isOpen) {
    return null
  }

  return createPortal(
    <div className="notification-center-portal">
      <NotificationsPage
        unreadCount={unreadCount}
        realtimeVersion={realtimeVersion}
        onUnreadCountChange={setUnreadCount}
        onNavigate={navigateFromNotification}
      />
    </div>,
    portalTarget,
  )
}
