import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../shared/api/apiClient'
import {
  discardPrimedDeal,
  getDeal,
  primeDealForNextRead,
} from '../../shared/api/dealsApi'
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

type LoadState = 'loading' | 'ready' | 'error'

export function RealtimeDealModal({
  dealId,
  dealName,
  onClose,
}: RealtimeDealModalProps) {
  const updateWarningShownRef = useRef(false)
  const deletedRef = useRef(false)
  const suppressOwnUpdateUntilRef = useRef(0)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [loadRevision, setLoadRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    discardPrimedDeal(dealId)
    setLoadState('loading')
    setLoadError('')

    void getDeal(dealId, controller.signal)
      .then((deal) => {
        if (controller.signal.aborted) {
          return
        }

        primeDealForNextRead(deal)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return
        }

        if (error instanceof ApiError && error.status === 404) {
          showCrmToast('Сделка не найдена или была удалена')
          onClose()
          return
        }

        if (error instanceof ApiError && error.status === 403) {
          showCrmToast('У вас нет доступа к этой сделке')
          onClose()
          return
        }

        setLoadError(
          error instanceof Error
            ? error.message
            : 'Не удалось загрузить данные сделки.',
        )
        setLoadState('error')
      })

    return () => {
      controller.abort()
      discardPrimedDeal(dealId)
    }
  }, [dealId, loadRevision, onClose])

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

  if (loadState !== 'ready') {
    return (
      <div className="create-deal-overlay" role="presentation">
        <div
          className="create-deal-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deal-guard-title"
          aria-busy={loadState === 'loading'}
        >
          <header className="create-deal-modal__header">
            <h2 id="deal-guard-title">Просмотр сделки</h2>
            <button
              className="create-deal-modal__close"
              type="button"
              aria-label="Закрыть"
              onClick={onClose}
            >
              ×
            </button>
          </header>

          <div
            className="create-deal-v2__loading"
            role={loadState === 'error' ? 'alert' : 'status'}
          >
            {loadState === 'loading' ? (
              'Загружаем данные сделки…'
            ) : (
              <>
                <p>{loadError}</p>
                <button
                  type="button"
                  onClick={() => setLoadRevision((revision) => revision + 1)}
                >
                  Повторить
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
