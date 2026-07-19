import {
  useEffect,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  getDeal,
  type ApiDealDetail,
} from '../../shared/api/dealsApi'
import { EditDealModal } from './EditDealModal'
import './ViewDealModal.css'

type ViewDealModalProps = {
  dealId: string
  dealName: string
  onClose: () => void
}

export function ViewDealModal({
  dealId,
  dealName,
  onClose,
}: ViewDealModalProps) {
  const [deal, setDeal] = useState<ApiDealDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadDeal() {
      try {
        setIsLoading(true)
        setLoadError('')

        const loadedDeal = await getDeal(dealId)

        if (!isMounted) {
          return
        }

        setDeal(loadedDeal)
        setIsLoading(false)
      } catch (error) {
        if (!isMounted) {
          return
        }

        setLoadError(
          error instanceof Error
            ? error.message
            : 'Не удалось загрузить данные сделки.',
        )
        setIsLoading(false)
      }
    }

    void loadDeal()

    return () => {
      isMounted = false
    }
  }, [dealId])

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !isEditModalOpen) {
      onClose()
    }
  }

  return (
    <>
      <div
        className="view-deal-overlay"
        role="presentation"
        onMouseDown={handleOverlayMouseDown}
        onKeyDown={handleKeyDown}
      >
        <div
          className="view-deal-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="view-deal-title"
          aria-busy={isLoading}
          tabIndex={-1}
        >
          <header className="view-deal-modal__header">
            <h2 id="view-deal-title">Просмотр сделки</h2>
            <button
              className="view-deal-modal__close"
              type="button"
              aria-label="Закрыть окно"
              onClick={onClose}
            >
              ×
            </button>
          </header>

          <div className="view-deal-modal__body">
            <button
              className="view-deal-modal__edit"
              type="button"
              aria-label="Редактировать сделку"
              title="Редактировать сделку"
              disabled={!deal || isLoading}
              onClick={() => setIsEditModalOpen(true)}
            >
              <EditIcon />
            </button>

            {deal && (
              <div className="view-deal-content">
                <ViewRow label="Название сделки" value={deal.name} />
                <ViewRow
                  label="Сделка на сумму"
                  value={formatAmount(deal.amount, deal.currency)}
                />

                <div className="view-deal-content__contact">
                  <ViewRow label="ФИО" value={deal.contact?.name} />
                  <ViewRow label="Компания" value={deal.contact?.company} />
                  <ViewRow label="Телефон:" value={deal.contact?.phone} />
                  <ViewRow label="e-mail:" value={deal.contact?.email} />
                </div>

                <div className="view-deal-content__divider" />

                {deal.contact?.telegram && (
                  <div className="view-deal-content__telegram">
                    <span className="view-deal-content__telegram-icon" aria-hidden="true">
                      <TelegramIcon />
                    </span>
                    <span>{deal.contact.telegram}</span>
                  </div>
                )}

                <div className="view-deal-content__messenger-block">
                  <button
                    className="view-deal-content__messenger-button"
                    type="button"
                    disabled
                    title="Добавление мессенджера доступно в режиме редактирования"
                  >
                    Добавить мессенджер
                  </button>
                  <div className="view-deal-content__divider" />
                </div>

                <div className="view-deal-content__comment">
                  <span>Комментарий:</span>
                  <p>{deal.comment || 'Написать...'}</p>
                </div>

                <button
                  className="view-deal-content__chat-button"
                  type="button"
                  disabled
                  title="Переход в чат будет добавлен позже"
                >
                  Перейти в чат
                </button>
              </div>
            )}
          </div>

          {(isLoading || loadError) && (
            <div
              className={`view-deal-modal__state${loadError ? ' view-deal-modal__state--error' : ''}`}
              role={loadError ? 'alert' : 'status'}
            >
              {loadError || 'Загружаем данные сделки…'}
            </div>
          )}
        </div>
      </div>

      {isEditModalOpen && (
        <EditDealModal
          dealId={dealId}
          dealName={deal?.name ?? dealName}
          onClose={() => setIsEditModalOpen(false)}
        />
      )}
    </>
  )
}

type ViewRowProps = {
  label: string
  value?: string | null
}

function ViewRow({ label, value }: ViewRowProps) {
  return (
    <div className="view-deal-content__row">
      <span>{label}</span>
      <strong title={value || 'Не указано'}>{value || 'Не указано'}</strong>
    </div>
  )
}

function formatAmount(amount: string | null, currency: string) {
  if (amount === null) {
    return 'Не указана'
  }

  const numericAmount = Number(amount)

  if (!Number.isFinite(numericAmount)) {
    return `${amount} ${currency}`
  }

  const formattedAmount = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(numericAmount)

  return currency === 'RUB'
    ? `${formattedAmount} ₽`
    : `${formattedAmount} ${currency}`
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="m15.5 5.5 3 3M4 20l4.2-1 10.7-10.7a1.4 1.4 0 0 0 0-2l-1.2-1.2a1.4 1.4 0 0 0-2 0L5 15.8 4 20Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M21.4 3.3 18.3 20c-.2 1.2-.9 1.5-1.9.9l-4.7-3.5-2.3 2.2c-.2.3-.5.5-1 .5l.3-4.8 8.8-8c.4-.3-.1-.5-.6-.2L6 14l-4.7-1.5c-1-.3-1-1 .2-1.5L20 3.9c.9-.3 1.7.2 1.4-.6Z"
        fill="currentColor"
      />
    </svg>
  )
}
