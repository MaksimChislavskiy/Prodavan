export const CRM_TOAST_EVENT = 'prodavan:crm-toast'

export function showCrmToast(message: string) {
  const normalizedMessage = message.trim()

  if (!normalizedMessage || typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent(CRM_TOAST_EVENT, {
      detail: { message: normalizedMessage },
    }),
  )
}
