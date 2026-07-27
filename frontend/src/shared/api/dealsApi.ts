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

export function getKanban() {
  return apiRequest<ApiKanbanResponse>('/api/crm/kanban')
}

export function getDeal(dealId: string) {
  return apiRequest<ApiDealDetail>(`/api/crm/deals/${dealId}`)
}

export function getDealsPage(
  stageId: string,
  limit = 100,
  cursor?: string | null,
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

export function createDeal(data: CreateDealRequest) {
  return apiRequest<ApiKanbanDeal>('/api/crm/deals', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey('deal-create'),
    },
    body: data,
  })
}

export function updateDeal(dealId: string, data: UpdateDealRequest) {
  return apiRequest<ApiDealDetail>(`/api/crm/deals/${dealId}`, {
    method: 'PATCH',
    body: data,
  })
}

export function deleteDeal(dealId: string) {
  return apiRequest<void>(`/api/crm/deals/${dealId}`, {
    method: 'DELETE',
  })
}

export function moveDeal(dealId: string, data: MoveDealRequest) {
  return apiRequest<ApiKanbanDeal>(`/api/crm/deals/${dealId}/stage`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey('deal-move'),
    },
    body: data,
  })
}

function createIdempotencyKey(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
