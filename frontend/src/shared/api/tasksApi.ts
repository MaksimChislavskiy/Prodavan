import { apiRequest } from './apiClient'

export type ApiTaskContact = {
  id: string
  name: string
  company: string
}

export type ApiTaskDeal = {
  id: string
  title: string
  amount: string
  currency: string
}

export type ApiDashboardTask = {
  id: string
  title: string
  due_date: string | null
  due_date_type: 'none' | 'date' | 'datetime'
  status: 'new' | 'in_progress' | 'done'
  contact: ApiTaskContact | null
  deal: ApiTaskDeal | null
  created_by_ai: boolean
  created_by_user_id: string | null
  version: number
  is_overdue: boolean
  created_at: string
  updated_at: string
}

export type TasksDashboardResponse = {
  tasks: ApiDashboardTask[]
  total_count: number
}

export function getTasksDashboard() {
  return apiRequest<TasksDashboardResponse>('/api/tasks/dashboard')
}