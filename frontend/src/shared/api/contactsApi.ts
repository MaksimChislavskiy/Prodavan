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

export type ApiContactAutocomplete = Pick<
  ApiContact,
  'id' | 'name' | 'company' | 'phone' | 'email' | 'telegram'
>

export type CreateContactRequest = {
  name: string
  company?: string | null
  phone?: string | null
  email?: string | null
  telegram?: string | null
}

export type UpdateContactRequest = CreateContactRequest & {
  version: number
}

export function getContact(contactId: string) {
  return apiRequest<ApiContact>(`/api/contacts/${contactId}`)
}

export function searchContacts(query: string, limit = 5) {
  const searchParams = new URLSearchParams({
    query,
    limit: String(limit),
  })

  return apiRequest<ApiContactAutocomplete[]>(
    `/api/contacts/search?${searchParams.toString()}`,
  )
}

export function createContact(data: CreateContactRequest) {
  return apiRequest<ApiContact>('/api/contacts', {
    method: 'POST',
    body: data,
  })
}

export function updateContact(contactId: string, data: UpdateContactRequest) {
  return apiRequest<ApiContact>(`/api/contacts/${contactId}`, {
    method: 'PATCH',
    body: data,
  })
}
