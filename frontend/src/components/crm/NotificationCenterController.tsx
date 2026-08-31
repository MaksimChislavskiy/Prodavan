import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { refreshSession } from '../../shared/api/authApi'
import { clearAccessToken } from '../../shared/api/authToken'
import {
  createNotificationsSocket,
  getNotificationUnreadCount,
  type NotificationRealtimeEnvelope,
  type NotificationRealtimeEvent,
} from '../../shared/api/notificationsApi'
import { readNotificationPreferences } from '../../shared/notificationPreferences'
import { FigmaNotificationsPage } from './FigmaNotificationsPage'
import './FigmaNotificationsPage.css'

const NOTIFICATIONS_PATH = '/app/notifications'
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]
const FALLBACK_POLL_INTERVAL_MS = 10_000

type BrowserNotificationPayload = {
  id: string
  title: string
  content: string
  link: string
}

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

function getBrowserNotificationPayload(
  event: NotificationRealtimeEvent,
): BrowserNotificationPayload | null {
  if (event.event !== 'notification_created') {
    return null
  }

  const payload = event.payload

  if (!payload || typeof payload !== 'object') {
    return null
  }

  const candidate = payload as {
    id?: unknown
    title?: unknown
    content?: unknown
    link?: unknown
  }

  if (typeof candidate.title !== 'string' || !candidate.title.trim()) {
    return null
  }

  return {
    id: typeof candidate.id === 'string' ? candidate.id : candidate.title,
    title: candidate.title.trim(),
    content: typeof candidate.content === 'string' ? candidate.content.trim() : '',
    link: typeof candidate.link === 'string' ? candidate.link.trim() : '',
  }
}

export function NotificationCenterController() {
  const [isOpen, setIsOpen] = useState(() =>
    isNotificationsPath(window.location.pathname),
  )
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [realtimeEnvelope, setRealtimeEnvelope] =
    useState<NotificationRealtimeEnvelope | null>(null)
  const [fallbackRevision, setFallbackRevision] = useState(0)
  const realtimeSequenceRef = useRef(0)

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
    let fallbackTimerId: number | null = null
    let socket: WebSocket | null = null

    const showBrowserNotification = (event: NotificationRealtimeEvent) => {
      if (
        !document.hidden ||
        !('Notification' in window) ||
        window.Notification.permission !== 'granted' ||
        !readNotificationPreferences().browserEnabled
      ) {
        return
      }

      const payload = getBrowserNotificationPayload(event)

      if (!payload) {
        return
      }

      const desktopNotification = new window.Notification(payload.title, {
        body: payload.content,
        icon: '/favicon.svg',
        tag: `prodavan-notification-${payload.id}`,
      })

      desktopNotification.onclick = () => {
        window.focus()
        desktopNotification.close()

        if (payload.link) {
          navigateFromNotification(payload.link)
          return
        }

        openNotifications()
      }
    }

    const startFallbackPolling = () => {
      if (isDisposed || fallbackTimerId !== null) {
        return
      }

      const poll = () => {
        void refreshUnreadCount()

        if (isNotificationsPath(window.location.pathname)) {
          // Section 14 explicitly requires a 10-second polling fallback when
          // WebSocket is unavailable. Remount the page only in that fallback
          // mode so its first 50 notifications are reconciled through REST.
          setFallbackRevision((revision) => revision + 1)
        }
      }

      poll()
      fallbackTimerId = window.setInterval(poll, FALLBACK_POLL_INTERVAL_MS)
    }

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

    const reconnectAfterTokenRefresh = async () => {
      try {
        await refreshSession()
      } catch {
        clearAccessToken()
        window.location.replace('/')
        return
      }

      if (!isDisposed) {
        reconnectAttempt = 0
        connect()
      }
    }

    const connect = () => {
      if (isDisposed) {
        return
      }

      if (typeof WebSocket === 'undefined') {
        startFallbackPolling()
        return
      }

      socket = createNotificationsSocket()

      if (!socket) {
        scheduleReconnect()
        return
      }

      socket.onopen = () => {
        reconnectAttempt = 0
        // REST reconciliation is deliberately performed on every successful
        // reconnect. This is stronger than the section 14 requirement to do it
        // after disconnects longer than one minute and avoids stale badges.
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

        showBrowserNotification(event)

        if (event.event === 'notification_created') {
          // The following unread_count_updated event remains authoritative, but
          // increment immediately so the badge reacts without waiting for it.
          setUnreadCount((current) => current + 1)
        }

        const nextUnreadCount = getUnreadCountFromEvent(event)
        if (nextUnreadCount !== null) {
          setUnreadCount(nextUnreadCount)
        }

        realtimeSequenceRef.current += 1
        setRealtimeEnvelope({
          sequence: realtimeSequenceRef.current,
          event,
        })
      }

      socket.onclose = (closeEvent) => {
        socket = null

        if (isDisposed) {
          return
        }

        if (closeEvent.code === 1008) {
          void reconnectAfterTokenRefresh()
          return
        }

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

      if (fallbackTimerId !== null) {
        window.clearInterval(fallbackTimerId)
      }

      socket?.close()
    }
  }, [navigateFromNotification, openNotifications, refreshUnreadCount])

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

    const shell = portalTarget.closest<HTMLElement>('.crm-shell')

    portalTarget.classList.toggle('crm-content--notification-center', isOpen)
    shell?.classList.toggle('crm-shell--notifications-open', isOpen)

    return () => {
      portalTarget.classList.remove('crm-content--notification-center')
      shell?.classList.remove('crm-shell--notifications-open')
    }
  }, [isOpen, portalTarget])

  if (!portalTarget || !isOpen) {
    return null
  }

  return createPortal(
    <div className="notification-center-portal">
      <FigmaNotificationsPage
        key={`notifications-${fallbackRevision}`}
        unreadCount={unreadCount}
        realtimeEnvelope={realtimeEnvelope}
        onUnreadCountChange={setUnreadCount}
        onNavigate={navigateFromNotification}
      />
    </div>,
    portalTarget,
  )
}
