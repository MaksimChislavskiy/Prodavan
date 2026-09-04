import { useEffect, useState } from 'react'
import { CRM_TOAST_EVENT } from '../../shared/crmToast'
import './CrmToastController.css'

export function CrmToastController() {
  const [message, setMessage] = useState('')

  useEffect(() => {
    let timeoutId: number | null = null

    const handleToast = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return
      }

      const nextMessage = (event.detail as { message?: unknown } | null)?.message
      if (typeof nextMessage !== 'string' || !nextMessage.trim()) {
        return
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }

      setMessage(nextMessage.trim())
      timeoutId = window.setTimeout(() => {
        setMessage('')
        timeoutId = null
      }, 5000)
    }

    window.addEventListener(CRM_TOAST_EVENT, handleToast)

    return () => {
      window.removeEventListener(CRM_TOAST_EVENT, handleToast)
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  if (!message) {
    return null
  }

  return (
    <div className="crm-global-toast" role="status" aria-live="polite">
      <span aria-hidden="true">✓</span>
      <p>{message}</p>
      <button
        type="button"
        aria-label="Закрыть уведомление"
        onClick={() => setMessage('')}
      >
        ×
      </button>
    </div>
  )
}
