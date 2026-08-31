import { apiRequest } from './apiClient'

export type ApiDealContactSummary = {
  id: string
  name: string
  company: string | null
  phone: string | null
}

export type ApiDealContactDetail = ApiDealContactSummary & {
  email: string | null
  telegram: string | null
}

export type ApiKanbanDeal = {
  id: string
  name: string
  version: number
  amount: string | null
  currency: string
  contact: ApiDealContactSummary | null
  created_at: string
  updated_at: string
}

export type ApiDealDetail = {
  id: string
  name: string
  amount: string | null
  currency: string
  stage_id: string
  version: number
  comment: string | null
  ai_insights: unknown
  contact: ApiDealContactDetail | null
  created_at: string
  updated_at: string
}

export type ApiSalesStage = {
  id: string
  name: string
  is_system: boolean
  is_final: boolean
  order: number
  version: number
  deal_count: number
}

export type ApiCreatedSalesStage = Omit<ApiSalesStage, 'deal_count'>

export type ApiKanbanResponse = {
  stages: ApiSalesStage[]
  deals: Record<string, ApiKanbanDeal[]>
}

export type ApiDealsPageResponse = {
  deals: ApiKanbanDeal[]
  next_cursor: string | null
  has_more: boolean
}

export type CreateSalesStageRequest = {
  name: string
  order: number
}

export type UpdateSalesStageRequest = {
  version: number
  name: string
}

export type CreateDealRequest = {
  name: string
  amount?: string | null
  currency?: string
  contact_id?: string | null
  comment?: string | null
}

export type UpdateDealRequest = {
  version: number
  name?: string
  amount?: string | null
  contact_id?: string | null
  comment?: string | null
}

export type MoveDealRequest = {
  stage_id: string
  version: number
}

export function getKanban(signal?: AbortSignal) {
  return apiRequest<ApiKanbanResponse>('/api/crm/kanban', { signal })
}

export function getDeal(dealId: string, signal?: AbortSignal) {
  return apiRequest<ApiDealDetail>(`/api/crm/deals/${dealId}`, { signal })
}

export function getDealsPage(
  stageId: string,
  limit = 20,
  cursor?: string | null,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams({
    stage_id: stageId,
    limit: String(limit),
  })

  if (cursor) {
    searchParams.set('cursor', cursor)
  }

  return apiRequest<ApiDealsPageResponse>(
    `/api/crm/deals?${searchParams.toString()}`,
    { signal },
  )
}

export function createSalesStage(data: CreateSalesStageRequest) {
  return apiRequest<ApiCreatedSalesStage>('/api/crm/stages', {
    method: 'POST',
    body: data,
  })
}

export function updateSalesStage(stageId: string, data: UpdateSalesStageRequest) {
  return apiRequest<ApiCreatedSalesStage>(`/api/crm/stages/${stageId}`, {
    method: 'PATCH',
    body: data,
  })
}

export function deleteSalesStage(stageId: string, version: number) {
  return apiRequest<void>(`/api/crm/stages/${stageId}`, {
    method: 'DELETE',
    headers: {
      'If-Match': `"${version}"`,
    },
  })
}

export function createDeal(
  data: CreateDealRequest,
  idempotencyKey = createUuidV4(),
  signal?: AbortSignal,
) {
  return apiRequest<ApiKanbanDeal>('/api/crm/deals', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
    body: data,
    signal,
  })
}

export function createDealIdempotencyKey() {
  return createUuidV4()
}

export function updateDeal(
  dealId: string,
  data: UpdateDealRequest,
  signal?: AbortSignal,
) {
  return apiRequest<ApiDealDetail>(`/api/crm/deals/${dealId}`, {
    method: 'PATCH',
    body: data,
    signal,
  })
}

export function deleteDeal(dealId: string, signal?: AbortSignal) {
  return apiRequest<void>(`/api/crm/deals/${dealId}`, {
    method: 'DELETE',
    signal,
  })
}

export function moveDeal(
  dealId: string,
  data: MoveDealRequest,
  signal?: AbortSignal,
) {
  return apiRequest<ApiKanbanDeal>(`/api/crm/deals/${dealId}/stage`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createUuidV4(),
    },
    body: data,
    signal,
  })
}

function createUuidV4() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
