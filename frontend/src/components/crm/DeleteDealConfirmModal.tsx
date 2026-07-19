import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import './DeleteDealConfirmModal.css'

type DeleteDealConfirmModalProps = {
  dealName: string
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteDealConfirmModal({
  dealName,
  onCancel,
  onConfirm,
}: DeleteDealConfirmModalProps) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const timeoutId = window.setTimeout(() => {
      cancelButtonRef.current?.focus()
    }, 0)

    return () => {
      document.body.style.overflow = originalOverflow
      window.clearTimeout(timeoutId)
    }
  }, [])

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onCancel()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div
      className="delete-deal-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
      onKeyDown={handleKeyDown}
    >
      <div
        className="delete-deal-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-deal-title"
        aria-describedby="delete-deal-description"
        tabIndex={-1}
      >
        <div className="delete-deal-modal__copy">
          <h2 id="delete-deal-title">Удаление сделки</h2>
          <p id="delete-deal-description">
            Вы действительно хотите
            <br />
            безвозвратно удалить этот объект?
          </p>
        </div>

        <div className="delete-deal-modal__actions">
          <button
            className="delete-deal-modal__button delete-deal-modal__button--confirm"
            type="button"
            aria-label={`Подтвердить удаление сделки ${dealName}`}
            title="Фактическое удаление подключим следующим этапом"
            onClick={onConfirm}
          >
            Да
          </button>

          <button
            ref={cancelButtonRef}
            className="delete-deal-modal__button delete-deal-modal__button--cancel"
            type="button"
            onClick={onCancel}
          >
            Нет
          </button>
        </div>
      </div>
    </div>
  )
}
