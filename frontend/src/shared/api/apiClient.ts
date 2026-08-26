import { clearAccessToken, getAccessToken, setAccessToken } from './authToken'

type ApiRequestOptions = {
  method?: string
  body?: unknown
  headers?: HeadersInit
  signal?: AbortSignal
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
  return makeApiRequest<TResponse>(path, options, true)
}

async function makeApiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions,
  canRefreshToken: boolean,
): Promise<TResponse> {
  const response = await fetchWithAuth(path, options)
  const data = await response.json().catch(() => null)

  if (response.status === 401 && canRefreshToken && path !== '/api/auth/refresh') {
    const isRefreshed = await refreshAccessToken()

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
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
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
