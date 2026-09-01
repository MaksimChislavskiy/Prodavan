import { refreshSession } from './api/authApi'
import {
  AUTH_TOKEN_CHANGED_EVENT,
  clearAccessToken,
  getAccessToken,
} from './api/authToken'

export const CRM_REALTIME_EVENT = 'prodavan:crm-realtime'
export const CRM_REALTIME_RECONNECTED_EVENT = 'prodavan:crm-realtime-reconnected'

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000]
const TOKEN_REFRESH_MARGIN_MS = 15_000

let socket: WebSocket | null = null
let reconnectTimer: number | null = null
let tokenRefreshTimer: number | null = null
let reconnectAttempt = 0
let connectionGeneration = 0
let hasOpenedBefore = false
let installed = false
let isRefreshingSession = false

export function installCrmRealtime() {
  if (installed || typeof window === 'undefined') {
    return
  }

  installed = true
  window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, handleTokenChanged)

  if (getAccessToken()) {
    connectWithCurrentToken()
  }
}

function handleTokenChanged() {
  cancelReconnect()
  cancelTokenRefresh()
  connectionGeneration += 1

  if (socket) {
    socket.close(1000, 'Access token changed')
    socket = null
  }

  if (getAccessToken()) {
    reconnectAttempt = 0
    connectWithCurrentToken()
  }
}

function connectWithCurrentToken() {
  const token = getAccessToken()
  if (!token || typeof WebSocket === 'undefined') {
    return
  }

  cancelReconnect()
  const generation = ++connectionGeneration
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${window.location.host}/ws/chat`
  const nextSocket = new WebSocket(url, ['bearer', token])
  socket = nextSocket

  nextSocket.addEventListener('open', () => {
    if (generation !== connectionGeneration) {
      return
    }

    const isReconnect = hasOpenedBefore
    hasOpenedBefore = true
    reconnectAttempt = 0
    scheduleTokenRefresh(token)

    if (isReconnect) {
      window.dispatchEvent(new Event(CRM_REALTIME_RECONNECTED_EVENT))
    }
  })

  nextSocket.addEventListener('message', (event) => {
    if (generation !== connectionGeneration || typeof event.data !== 'string') {
      return
    }

    try {
      const payload = JSON.parse(event.data) as unknown
      window.dispatchEvent(
        new CustomEvent(CRM_REALTIME_EVENT, { detail: payload }),
      )
    } catch {
      // Ignore malformed server frames. The next valid event or reconnect syncs state.
    }
  })

  nextSocket.addEventListener('close', (event) => {
    if (generation !== connectionGeneration) {
      return
    }

    socket = null
    cancelTokenRefresh()

    if (!getAccessToken()) {
      return
    }

    if (event.code === 1008) {
      void refreshAndReconnect()
      return
    }

    scheduleReconnect()
  })
}

function scheduleReconnect() {
  if (reconnectTimer !== null || !getAccessToken()) {
    return
  }

  const delay =
    RECONNECT_DELAYS_MS[
      Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ]
  reconnectAttempt += 1

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    connectWithCurrentToken()
  }, delay)
}

function scheduleTokenRefresh(token: string) {
  cancelTokenRefresh()

  const expiresAt = getJwtExpiryMs(token)
  if (expiresAt === null) {
    return
  }

  const delay = Math.max(1000, expiresAt - Date.now() - TOKEN_REFRESH_MARGIN_MS)
  tokenRefreshTimer = window.setTimeout(() => {
    tokenRefreshTimer = null
    void refreshAndReconnect()
  }, delay)
}

async function refreshAndReconnect() {
  if (isRefreshingSession) {
    return
  }

  isRefreshingSession = true
  try {
    await refreshSession()
    // refreshSession updates the in-memory token; its event reconnects the socket.
  } catch {
    clearAccessToken()
    if (window.location.pathname.startsWith('/app')) {
      window.location.replace('/')
    }
  } finally {
    isRefreshingSession = false
  }
}

function getJwtExpiryMs(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = JSON.parse(window.atob(padded)) as { exp?: unknown }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

function cancelReconnect() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function cancelTokenRefresh() {
  if (tokenRefreshTimer !== null) {
    window.clearTimeout(tokenRefreshTimer)
    tokenRefreshTimer = null
  }
}
