import { clearAccessToken, getAccessToken, setAccessToken } from './authToken'

type ApiRequestOptions = {
  method?: string
  body?: unknown
  headers?: HeadersInit
}

type RefreshSessionResponse = {
  access_token: string
}

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
    throw new Error(getApiErrorMessage(data, response.status))
  }

  return data as TResponse
}

async function fetchWithAuth(path: string, options: ApiRequestOptions) {
  const token = getAccessToken()

  const headers = new Headers(options.headers)

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  })
}

async function refreshAccessToken() {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })

    const data = await response.json().catch(() => null)

    if (!response.ok || !isRefreshSessionResponse(data)) {
      clearAccessToken()
      return false
    }

    setAccessToken(data.access_token)
    return true
  } catch {
    clearAccessToken()
    return false
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
  if (
    data &&
    typeof data === 'object' &&
    'detail' in data &&
    typeof data.detail === 'string'
  ) {
    return data.detail
  }

  if (
    data &&
    typeof data === 'object' &&
    'message' in data &&
    typeof data.message === 'string'
  ) {
    return data.message
  }

  return `Ошибка запроса. Код: ${status}`
}