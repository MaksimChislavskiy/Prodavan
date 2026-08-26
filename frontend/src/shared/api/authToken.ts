let accessToken: string | null = null

export const AUTH_TOKEN_CHANGED_EVENT = 'prodavan:auth-token-changed'

export function setAccessToken(token: string | null) {
  accessToken = token

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(AUTH_TOKEN_CHANGED_EVENT, {
        detail: { hasToken: Boolean(token) },
      }),
    )
  }
}

export function getAccessToken() {
  return accessToken
}

export function clearAccessToken() {
  setAccessToken(null)
}
