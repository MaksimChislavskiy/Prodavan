import { apiRequest } from './apiClient'

export type ApiProfile = {
  id: string
  name: string
  position: string
  phone: string
  email: string
  avatar: string | null
  avatar_small: string | null
  avatar_medium: string | null
  version: number
}

export type UpdateProfileRequest = {
  version: number
  name: string
  position: string
  phone: string
  email: string
}

export function getProfile() {
  return apiRequest<ApiProfile>('/api/profile')
}

export function updateProfile(data: UpdateProfileRequest) {
  return apiRequest<ApiProfile>('/api/profile', {
    method: 'PATCH',
    body: data,
  })
}
