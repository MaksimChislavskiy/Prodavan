import { apiRequest } from './apiClient'
import {
  getKnowledgeFiles,
  type ApiKnowledgeDocument,
} from './aiSettingsApi'

export type ApiOnboardingStatusName = 'not_started' | 'in_progress' | 'completed'
export type ApiOnboardingMaterial = 'video' | 'pdf'

export type ApiOnboardingStatus = {
  version: number
  status: ApiOnboardingStatusName
  completed_at: string | null
  steps: {
    knowledge_base_completed: boolean
    materials_viewed: boolean
  }
}

const ONBOARDING_STATUS_URL = '/api/user/onboarding-status'
const ONBOARDING_MATERIALS_URL = '/api/user/onboarding/materials-viewed'

export function getOnboardingStatus() {
  return apiRequest<ApiOnboardingStatus>(ONBOARDING_STATUS_URL)
}

export function markOnboardingMaterialViewed(material: ApiOnboardingMaterial) {
  return apiRequest<ApiOnboardingStatus>(ONBOARDING_MATERIALS_URL, {
    method: 'POST',
    body: { material },
  })
}

export async function getAllOnboardingKnowledgeFiles() {
  const pageSize = 50
  const firstPage = await getKnowledgeFiles(1, pageSize)
  if (firstPage.total <= firstPage.files.length) {
    return firstPage.files
  }

  const totalPages = Math.ceil(firstPage.total / pageSize)
  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) => (
      getKnowledgeFiles(index + 2, pageSize)
    )),
  )

  return remainingPages.reduce<ApiKnowledgeDocument[]>(
    (files, page) => files.concat(page.files),
    [...firstPage.files],
  )
}
