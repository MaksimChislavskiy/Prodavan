import { useEffect, useRef } from 'react'
import { CRM_REALTIME_EVENT } from '../../shared/crmRealtime'
import { CRM_TOAST_EVENT, showCrmToast } from '../../shared/crmToast'
import { EditDealModal as EditDealModalV2 } from './EditDealModalV2'

type RealtimeDealModalProps = {
  dealId: string
  dealName: string
  onClose: () => void
}

type RealtimePayload = {
  event?: unknown
  deal_id?: unknown
  data?: {
    deal_id?: unknown
  }
}

type ToastPayload = {
  message?: unknown
}

export function RealtimeDealModal({
  dealId,
  dealName,
  onClose,
}: RealtimeDealModalProps) {
  const updateWarningShownRef = useRef(false)
  const deletedRef = useRef(false)
  const suppressOwnUpdateUntilRef = useRef(0)

  useEffect(() => {
    updateWarningShownRef.current = false
    deletedRef.current = false
    suppressOwnUpdateUntilRef.current = 0

    const handleToast = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return
      }

      const payload = event.detail as ToastPayload | null
      if (payload?.message === 'Сделка успешно обновлена') {
        suppressOwnUpdateUntilRef.current = Date.now() + 1_500
      }
    }

    const handleRealtime = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return
      }

      const payload = event.detail as RealtimePayload | null
      const eventName = typeof payload?.event === 'string' ? payload.event : ''
      const eventDealId = getDealId(payload)

      if (!eventDealId || eventDealId !== dealId) {
        return
      }

      if (eventName === 'deal_deleted') {
        if (deletedRef.current) {
          return
        }

        deletedRef.current = true
        showCrmToast('Сделка была удалена другим пользователем')
        onClose()
        return
      }

      if (eventName !== 'deal_updated' || updateWarningShownRef.current) {
        return
      }

      // Собственное PATCH-обновление тоже приходит по WebSocket. Пока форма занята
      // сохранением или только что получила успешный ответ PATCH, предупреждение не
      // показываем. Внешнее конкурентное изменение всё равно ловится version=.../409.
      if (
        document.querySelector('.create-deal-modal[aria-busy="true"]')
        || Date.now() < suppressOwnUpdateUntilRef.current
      ) {
        return
      }

      updateWarningShownRef.current = true
      showCrmToast('Сделка была изменена другим пользователем. Обновите данные.')
    }

    window.addEventListener(CRM_TOAST_EVENT, handleToast)
    window.addEventListener(CRM_REALTIME_EVENT, handleRealtime)
    return () => {
      window.removeEventListener(CRM_TOAST_EVENT, handleToast)
      window.removeEventListener(CRM_REALTIME_EVENT, handleRealtime)
    }
  }, [dealId, onClose])

  return (
    <EditDealModalV2
      dealId={dealId}
      dealName={dealName}
      onClose={onClose}
    />
  )
}

function getDealId(payload: RealtimePayload | null) {
  if (typeof payload?.deal_id === 'string') {
    return payload.deal_id
  }

  return typeof payload?.data?.deal_id === 'string'
    ? payload.data.deal_id
    : null
}
