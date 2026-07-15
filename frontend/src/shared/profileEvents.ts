import type { ApiProfile } from './api/profileApi'

export const PROFILE_UPDATED_EVENT = 'crm:profile-updated'

export function notifyProfileUpdated(profile: ApiProfile) {
  window.dispatchEvent(
    new CustomEvent<ApiProfile>(PROFILE_UPDATED_EVENT, {
      detail: profile,
    }),
  )
}

export function getProfileFromUpdatedEvent(event: Event) {
  if (!(event instanceof CustomEvent)) {
    return null
  }

  return event.detail as ApiProfile
}
