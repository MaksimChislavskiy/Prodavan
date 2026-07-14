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

export type ApiKanbanResponse = {
  stages: ApiSalesStage[]
  deals: Record<string, ApiKanbanDeal[]>
}

export function getKanban() {
  return apiRequest<ApiKanbanResponse>('/api/crm/kanban')
}
