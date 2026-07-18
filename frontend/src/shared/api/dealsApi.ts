import { apiRequest } from './apiClient'

export type ApiDealContactSummary = {
  id: string
  name: string
  company: string | null
  phone: string | null
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

export type ApiSalesStage = {
  id: string
  name: string
  is_system: boolean
  order: number
  version: number
  deal_count: number
}

export type ApiCreatedSalesStage = Omit<ApiSalesStage, 'deal_count'>

export type ApiKanbanResponse = {
  stages: ApiSalesStage[]
  deals: Record<string, ApiKanbanDeal[]>
}

export type CreateSalesStageRequest = {
  name: string
  order: number
}

export type MoveDealRequest = {
  stage_id: string
  version: number
}

export function getKanban() {
  return apiRequest<ApiKanbanResponse>('/api/crm/kanban')
}

export function createSalesStage(data: CreateSalesStageRequest) {
  return apiRequest<ApiCreatedSalesStage>('/api/crm/stages', {
    method: 'POST',
    body: data,
  })
}

export function moveDeal(dealId: string, data: MoveDealRequest) {
  return apiRequest<ApiKanbanDeal>(`/api/crm/deals/${dealId}/stage`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(),
    },
    body: data,
  })
}

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `deal-move-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
