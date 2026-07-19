import { apiRequest } from './apiClient'

export type ApiContact = {
  id: string
  name: string
  company: string | null
  phone: string | null
  email: string | null
  telegram: string | null
  comment: string | null
  version: number
  created_at: string
  updated_at: string
}

export type CreateContactRequest = {
  name: string
  company?: string | null
  phone?: string | null
  email?: string | null
  telegram?: string | null
}

export function createContact(data: CreateContactRequest) {
  return apiRequest<ApiContact>('/api/contacts', {
    method: 'POST',
    body: data,
  })
}
