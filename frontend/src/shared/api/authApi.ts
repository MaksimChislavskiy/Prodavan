import { apiRequest } from './apiClient'
import { setAccessToken } from './authToken'

export type RegisterRequest = {
  name: string
  surname: string
  email: string
  password: string
}

export type ConfirmRegistrationRequest = {
  email: string
  code: string
}

export type CurrentUserRole = 'admin' | 'user'

export type CurrentUser = {
  id: string
  name: string
  surname: string
  email: string
  role: CurrentUserRole
  workspace_id: string | null
}

type ConfirmRegistrationResponse = {
  access_token: string
}

type RefreshSessionResponse = {
  access_token: string
}

type LogoutResponse = {
  message: string
}

let refreshSessionPromise: Promise<string> | null = null

export function startRegistration(data: RegisterRequest) {
  return apiRequest<unknown>('/api/auth/register', {
    method: 'POST',
    body: data,
  })
}

export function resendRegistrationCode(email: string) {
  return apiRequest<unknown>('/api/auth/register/resend', {
    method: 'POST',
    body: { email },
  })
}

export function expireRegistration(email: string) {
  return apiRequest<unknown>('/api/auth/register/expire', {
    method: 'POST',
    body: { email },
  })
}

export function confirmRegistration(data: ConfirmRegistrationRequest) {
  return apiRequest<ConfirmRegistrationResponse>('/api/auth/confirm', {
    method: 'POST',
    body: data,
  })
}

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

export function getCurrentUser() {
  return apiRequest<CurrentUser>('/api/auth/me')
}

export function logoutSession() {
  return apiRequest<LogoutResponse>('/api/auth/logout', {
    method: 'POST',
  })
}
