import { apiRequest } from './apiClient'
import { setAccessToken } from './authToken'

type RefreshSessionResponse = {
  access_token: string
}

let refreshSessionPromise: Promise<string> | null = null

export function refreshSession() {
  if (!refreshSessionPromise) {
    refreshSessionPromise = apiRequest<RefreshSessionResponse>('/api/auth/refresh', {
      method: 'POST',
    })
      .then((data) => {
        setAccessToken(data.access_token)

        return data.access_token
      })
      .finally(() => {
        refreshSessionPromise = null
      })
  }

  return refreshSessionPromise
}