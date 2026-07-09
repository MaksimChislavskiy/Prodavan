import { getAccessToken } from './authToken'

type ApiRequestOptions = {
  method?: string
  body?: unknown
  headers?: HeadersInit
}

export async function apiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TResponse> {
  const token = getAccessToken()

  const headers = new Headers(options.headers)

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(getApiErrorMessage(data, response.status))
  }

  return data as TResponse
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