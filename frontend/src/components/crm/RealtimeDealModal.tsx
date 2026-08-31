import { useEffect, useRef } from 'react'
import {
  CRM_REALTIME_EVENT,
  type CrmRealtimePayload,
} from '../../shared/crmRealtime'
import { showCrmToast } from '../../shared/crmToast'
import { EditDealModal as EditDealModalV2 } from './EditDealModalV2'

type RealtimeDealModalProps = {
  dealId: string
  dealName: string
  onClose: () => void
}

export function RealtimeDealModal({
  dealId,
  dealName,
  onClose,
}: RealtimeDealModalProps) {
  const updateWarningShownRef = useRef(false)
  const deletedRef = useRef(false)

  useEffect(() => {
    updateWarningShownRef.current = false
    deletedRef.current = false

    const handleRealtime = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return
      }

      const payload = event.detail as CrmRealtimePayload | null
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
      // сохранением, предупреждение не показываем: актуальный ответ PATCH сам обновит
      // локальный version/snapshot. Внешнее конкурентное изменение всё равно будет
      // выявлено optimistic locking при сохранении.
      if (document.querySelector('.create-deal-modal[aria-busy="true"]')) {
        return
      }

      updateWarningShownRef.current = true
      showCrmToast('Сделка была изменена другим пользователем. Обновите данные.')
    }

    window.addEventListener(CRM_REALTIME_EVENT, handleRealtime)
    return () => window.removeEventListener(CRM_REALTIME_EVENT, handleRealtime)
  }, [dealId, onClose])

  return (
    <EditDealModalV2
      dealId={dealId}
      dealName={dealName}
      onClose={onClose}
    />
  )
}

function getDealId(payload: CrmRealtimePayload | null) {
  if (typeof payload?.deal_id === 'string') {
    return payload.deal_id
  }

  return typeof payload?.data?.deal_id === 'string'
    ? payload.data.deal_id
    : null
}
