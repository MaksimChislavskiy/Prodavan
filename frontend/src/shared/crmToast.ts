export const CRM_TOAST_EVENT = 'prodavan:crm-toast'

const messageAliases: Record<string, string> = {
  'Сделка успешно сохранена': 'Сделка успешно обновлена',
}

export function showCrmToast(message: string) {
  const trimmedMessage = message.trim()
  const normalizedMessage = messageAliases[trimmedMessage] ?? trimmedMessage

  if (!normalizedMessage || typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent(CRM_TOAST_EVENT, {
      detail: { message: normalizedMessage },
    }),
  )
}
