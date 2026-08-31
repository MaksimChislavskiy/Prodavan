import { showCrmToast } from '../crmToast'
import { clearAccessToken, getAccessToken, setAccessToken } from './authToken'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const REQUEST_TIMEOUT_MESSAGE = 'Сервер не отвечает. Попробуйте позже.'
const NETWORK_ERROR_MESSAGE = 'Проверьте подключение к интернету'

type ApiRequestOptions = {
  method?: string
  body?: unknown
  headers?: HeadersInit
  signal?: AbortSignal
  timeoutMs?: number
  suppressGlobalErrorToast?: boolean
}

type RefreshSessionResponse = {
  access_token: string
}

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

let refreshAccessTokenPromise: Promise<boolean> | null = null

export async function apiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TResponse> {
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const controller = new AbortController()
  const sourceSignal = options.signal
  let didTimeout = false

  const handleSourceAbort = () => controller.abort()

  if (sourceSignal?.aborted) {
    controller.abort()
  } else {
    sourceSignal?.addEventListener('abort', handleSourceAbort, { once: true })
  }

  const timeoutId = window.setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, timeoutMs)

  try {
    return await makeApiRequest<TResponse>(
      path,
      {
        ...options,
        signal: controller.signal,
        timeoutMs: undefined,
      },
      true,
    )
  } catch (error) {
    if (didTimeout && isAbortError(error)) {
      if (!options.suppressGlobalErrorToast) {
        showCrmToast(REQUEST_TIMEOUT_MESSAGE)
      }
      throw new Error(REQUEST_TIMEOUT_MESSAGE)
    }

    if (!sourceSignal?.aborted && isNetworkError(error)) {
      if (!options.suppressGlobalErrorToast) {
        showCrmToast(NETWORK_ERROR_MESSAGE)
      }
      throw new Error(NETWORK_ERROR_MESSAGE)
    }

    throw error
  } finally {
    window.clearTimeout(timeoutId)
    sourceSignal?.removeEventListener('abort', handleSourceAbort)
  }
}

async function makeApiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions,
  canRefreshToken: boolean,
): Promise<TResponse> {
  const response = await fetchWithAuth(path, options)
  const data = await response.json().catch(() => null)

  if (response.status === 401 && canRefreshToken && path !== '/api/auth/refresh') {
    const isRefreshed = await waitForPromiseWithSignal(
      refreshAccessToken(),
      options.signal,
    )

    if (isRefreshed) {
      return makeApiRequest<TResponse>(path, options, false)
    }
  }

  if (!response.ok) {
    throw new ApiError(getApiErrorMessage(data, response.status), response.status, data)
  }

  return data as TResponse
}

async function fetchWithAuth(path: string, options: ApiRequestOptions) {
  const token = getAccessToken()
  const body = options.body
  const isFormDataBody = typeof FormData !== 'undefined' && body instanceof FormData

  const headers = new Headers(options.headers)

  if (body !== undefined && !isFormDataBody) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: body !== undefined ? getRequestBody(body, isFormDataBody) : undefined,
    credentials: 'include',
    signal: options.signal,
  })
}

function getRequestBody(body: unknown, isFormDataBody: boolean) {
  if (isFormDataBody) {
    return body as FormData
  }

  return JSON.stringify(body)
}

function refreshAccessToken() {
  if (!refreshAccessTokenPromise) {
    refreshAccessTokenPromise = performRefreshAccessToken().finally(() => {
      refreshAccessTokenPromise = null
    })
  }

  return refreshAccessTokenPromise
}

async function performRefreshAccessToken() {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    DEFAULT_REQUEST_TIMEOUT_MS,
  )

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    })

    const data = await response.json().catch(() => null)

    if (!response.ok || !isRefreshSessionResponse(data)) {
      handleExpiredSession()
      return false
    }

    setAccessToken(data.access_token)
    return true
  } catch {
    handleExpiredSession()
    return false
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function handleExpiredSession() {
  clearAccessToken()

  if (
    typeof window !== 'undefined'
    && window.location.pathname.startsWith('/app')
  ) {
    window.location.replace('/')
  }
}

function waitForPromiseWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    return promise
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError())
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      cleanup()
      reject(createAbortError())
    }

    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort)
    }

    signal.addEventListener('abort', handleAbort, { once: true })

    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function createAbortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError
}

function normalizeTimeout(timeoutMs?: number) {
  if (
    typeof timeoutMs !== 'number'
    || !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
  ) {
    return DEFAULT_REQUEST_TIMEOUT_MS
  }

  return timeoutMs
}

function isRefreshSessionResponse(data: unknown): data is RefreshSessionResponse {
  return (
    data !== null &&
    typeof data === 'object' &&
    'access_token' in data &&
    typeof data.access_token === 'string'
  )
}

function getApiErrorMessage(data: unknown, status: number) {
  return findApiErrorMessage(data) ?? `Ошибка запроса. Код: ${status}`
}

function findApiErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const message = value.trim()
    return message || null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = findApiErrorMessage(item)

      if (message) {
        return message
      }
    }

    return null
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const data = value as Record<string, unknown>
  const priorityKeys = [
    'error',
    'detail',
    'errors',
    'non_field_errors',
    'email',
    'phone',
    'telegram',
    'name',
    'surname',
    'password',
    'message',
    'code',
  ]

  for (const key of priorityKeys) {
    if (key in data) {
      const message = findApiErrorMessage(data[key])

      if (message) {
        return message
      }
    }
  }

  for (const nestedValue of Object.values(data)) {
    const message = findApiErrorMessage(nestedValue)

    if (message) {
      return message
    }
  }

  return null
}
