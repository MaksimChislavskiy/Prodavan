import { apiRequest } from './apiClient'

export type ApiContact = {
  id: string
  name: string
  company: string | null
  phone: string | null
  email: string | null
  telegram: string | null
  comment: string | null
  ai_insights?: unknown
  last_ai_deal_created_at?: string | null
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
  comment?: string | null
}

export type UpdateContactRequest = {
  version: number
  name?: string
  company?: string | null
  phone?: string | null
  email?: string | null
  telegram?: string | null
  comment?: string | null
}

export type ApiContactsResponse = {
  contacts: ApiContact[]
  total: number
  page: number
  limit: number
}

export type ApiBulkDeleteContactsResponse = {
  deleted_count: number
  skipped_ids: {
    id: string
    reason: 'not_found' | 'already_deleted'
  }[]
}

export function getContacts(page = 1, limit = 20, signal?: AbortSignal) {
  const searchParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort: 'name:asc,id:asc',
  })

  return apiRequest<ApiContactsResponse>(
    `/api/contacts?${searchParams.toString()}`,
    { signal },
  )
}

export function getContact(contactId: string, signal?: AbortSignal) {
  return apiRequest<ApiContact>(`/api/contacts/${contactId}`, { signal })
}

export function searchContacts(
  query: string,
  limit = 5,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams({
    query,
    limit: String(limit),
  })

  return apiRequest<ApiContactAutocomplete[]>(
    `/api/contacts/search?${searchParams.toString()}`,
    { signal },
  )
}

export function findContactByName(name: string, signal?: AbortSignal) {
  const searchParams = new URLSearchParams({ name })

  return apiRequest<ApiContactAutocomplete | null>(
    `/api/contacts/find-by-name?${searchParams.toString()}`,
    { signal },
  )
}

export function createContact(data: CreateContactRequest, signal?: AbortSignal) {
  return apiRequest<ApiContact>('/api/contacts', {
    method: 'POST',
    body: data,
    signal,
  })
}

export function updateContact(
  contactId: string,
  data: UpdateContactRequest,
  signal?: AbortSignal,
) {
  return apiRequest<ApiContact>(`/api/contacts/${contactId}`, {
    method: 'PATCH',
    body: data,
    signal,
  })
}

export function deleteContact(contactId: string, signal?: AbortSignal) {
  return apiRequest<void>(`/api/contacts/${contactId}`, {
    method: 'DELETE',
    signal,
  })
}

export function bulkDeleteContacts(contactIds: string[], signal?: AbortSignal) {
  return apiRequest<ApiBulkDeleteContactsResponse>('/api/contacts/bulk', {
    method: 'DELETE',
    body: {
      contact_ids: contactIds,
    },
    signal,
  })
}
