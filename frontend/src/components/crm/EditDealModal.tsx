import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import './EditDealModal.css'

type EditDealModalProps = {
  dealName: string
  onClose: () => void
}

export function EditDealModal({ dealName: initialDealName, onClose }: EditDealModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const [dealName, setDealName] = useState(initialDealName)
  const [amount, setAmount] = useState('')
  const [contactName, setContactName] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [telegram, setTelegram] = useState('')
  const [comment, setComment] = useState('')
  const [isMessengerOpen, setIsMessengerOpen] = useState(false)

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const timeoutId = window.setTimeout(() => {
      modalRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    }, 0)

    return () => {
      document.body.style.overflow = originalOverflow
      window.clearTimeout(timeoutId)
    }
  }, [])

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onClose()
    }
  }

  const removeContact = () => {
    setContactName('')
    setCompany('')
    setPhone('')
    setEmail('')
  }

  const removeMessenger = () => {
    setTelegram('')
    setIsMessengerOpen(false)
  }

  return (
    <div
      className="edit-deal-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={modalRef}
        className="edit-deal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-deal-title"
        tabIndex={-1}
      >
        <header className="edit-deal-modal__header">
          <h2 id="edit-deal-title">Редактировать сделку</h2>
          <button
            className="edit-deal-modal__close"
            type="button"
            aria-label="Закрыть окно"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className="edit-deal-form" onSubmit={(event) => event.preventDefault()}>
          <div className="edit-deal-form__content">
            <EditFieldRow label="Название сделки">
              <input
                className="edit-deal-form__plain-input"
                type="text"
                value={dealName}
                maxLength={255}
                placeholder="Введите название"
                onChange={(event) => setDealName(event.target.value)}
              />
            </EditFieldRow>

            <EditFieldRow label="Сделка на сумму">
              <div className="edit-deal-form__amount-wrap">
                <input
                  className="edit-deal-form__amount-input"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  maxLength={18}
                  aria-label="Сумма сделки"
                  placeholder="0"
                  onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ''))}
                />
                <span>₽</span>
              </div>
            </EditFieldRow>

            <div className="edit-deal-form__contact-block">
              <EditFieldRow label="ФИО">
                <div className="edit-deal-form__contact-input-wrap">
                  <input
                    className="edit-deal-form__contact-input"
                    type="text"
                    value={contactName}
                    maxLength={100}
                    placeholder="Введите ФИО"
                    onChange={(event) => setContactName(event.target.value)}
                  />
                  <button
                    className="edit-deal-form__remove"
                    type="button"
                    aria-label="Убрать контакт"
                    title="Убрать контакт"
                    onClick={removeContact}
                  >
                    ×
                  </button>
                </div>
              </EditFieldRow>

              <EditFieldRow label="Компания">
                <input
                  className="edit-deal-form__plain-input"
                  type="text"
                  value={company}
                  maxLength={100}
                  placeholder="Введите название"
                  onChange={(event) => setCompany(event.target.value)}
                />
              </EditFieldRow>

              <EditFieldRow label="Телефон:">
                <input
                  className="edit-deal-form__plain-input"
                  type="tel"
                  value={phone}
                  maxLength={64}
                  placeholder="Введите номер"
                  onChange={(event) => setPhone(event.target.value)}
                />
              </EditFieldRow>

              <EditFieldRow label="e-mail:">
                <input
                  className="edit-deal-form__plain-input"
                  type="email"
                  value={email}
                  maxLength={255}
                  placeholder="Введите e-mail"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </EditFieldRow>
            </div>

            <div className="edit-deal-form__divider" />

            {isMessengerOpen && (
              <div className="edit-deal-form__telegram-card">
                <span className="edit-deal-form__telegram-icon" aria-hidden="true">
                  <TelegramIcon />
                </span>
                <input
                  type="text"
                  value={telegram}
                  maxLength={64}
                  placeholder="@username"
                  aria-label="Telegram"
                  onChange={(event) => setTelegram(event.target.value)}
                />
                <button
                  className="edit-deal-form__remove"
                  type="button"
                  aria-label="Убрать Telegram"
                  title="Убрать Telegram"
                  onClick={removeMessenger}
                >
                  ×
                </button>
              </div>
            )}

            <div className="edit-deal-form__messenger-block">
              <button
                className="edit-deal-form__messenger-button"
                type="button"
                onClick={() => setIsMessengerOpen(true)}
              >
                Добавить мессенджер
              </button>
              <div className="edit-deal-form__divider" />
            </div>

            <label className="edit-deal-form__comment">
              <span>Комментарий:</span>
              <textarea
                value={comment}
                maxLength={500}
                placeholder="Написать..."
                onChange={(event) => setComment(event.target.value)}
              />
            </label>

            <button
              className="edit-deal-form__chat-button"
              type="button"
              title="Переход в чат будет добавлен позже"
            >
              Перейти в чат
            </button>
          </div>

          <button
            className="edit-deal-form__submit"
            type="button"
            aria-disabled="true"
            title="Сохранение подключим следующим этапом"
          >
            Сохранить
          </button>
        </form>
      </div>
    </div>
  )
}

type EditFieldRowProps = {
  label: string
  children: React.ReactNode
}

function EditFieldRow({ label, children }: EditFieldRowProps) {
  return (
    <label className="edit-deal-form__row">
      <span>{label}</span>
      {children}
    </label>
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
