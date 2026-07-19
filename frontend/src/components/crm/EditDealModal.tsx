import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  createContact,
  getContact,
  updateContact,
} from '../../shared/api/contactsApi'
import { getDeal, updateDeal } from '../../shared/api/dealsApi'
import './EditDealModal.css'
import './EditDealModalState.css'

type EditDealModalProps = {
  dealId: string
  dealName: string
  onClose: () => void
}

const CONTACT_NAME_PATTERN = /^[A-Za-zА-Яа-яЁё\- ]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/

export function EditDealModal({
  dealId,
  dealName: initialDealName,
  onClose,
}: EditDealModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const [dealName, setDealName] = useState(initialDealName)
  const [amount, setAmount] = useState('')
  const [contactName, setContactName] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [telegram, setTelegram] = useState('')
  const [comment, setComment] = useState('')
  const [dealVersion, setDealVersion] = useState<number | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)
  const [contactVersion, setContactVersion] = useState<number | null>(null)
  const [isMessengerOpen, setIsMessengerOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')

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

        const deal = await getDeal(dealId)
        const contact = deal.contact ? await getContact(deal.contact.id) : null

        if (!isMounted) {
          return
        }

        setDealName(deal.name)
        setAmount(deal.amount ?? '')
        setDealVersion(deal.version)
        setContactId(contact?.id ?? null)
        setContactVersion(contact?.version ?? null)
        setContactName(contact?.name ?? '')
        setCompany(contact?.company ?? '')
        setPhone(contact?.phone ?? '')
        setEmail(contact?.email ?? '')
        setTelegram(contact?.telegram ?? '')
        setComment(deal.comment ?? '')
        setIsMessengerOpen(Boolean(contact?.telegram))
        setIsLoading(false)

        window.setTimeout(() => {
          modalRef.current?.querySelector<HTMLInputElement>('input')?.focus()
        }, 0)
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
    if (!isSaving && event.target === event.currentTarget) {
      onClose()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isSaving && event.key === 'Escape') {
      onClose()
    }
  }

  const removeContact = () => {
    setContactId(null)
    setContactVersion(null)
    setContactName('')
    setCompany('')
    setPhone('')
    setEmail('')
    setTelegram('')
    setIsMessengerOpen(false)
    setSaveError('')
  }

  const removeMessenger = () => {
    setTelegram('')
    setIsMessengerOpen(false)
    setSaveError('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isLoading || isSaving || dealVersion === null) {
      return
    }

    const validationError = getValidationError({
      dealName,
      amount,
      contactName,
      email,
      telegram,
    })

    if (validationError) {
      setSaveError(validationError)
      return
    }

    try {
      setIsSaving(true)
      setSaveError('')

      const contactData = {
        name: contactName.trim(),
        company: emptyToNull(company),
        phone: emptyToNull(phone),
        email: emptyToNull(email.toLowerCase()),
        telegram: emptyToNull(telegram),
      }

      let savedContactId = contactId

      if (contactId && contactVersion !== null) {
        const contact = await updateContact(contactId, {
          version: contactVersion,
          ...contactData,
        })
        savedContactId = contact.id
        setContactVersion(contact.version)
      } else {
        const contact = await createContact(contactData)
        savedContactId = contact.id
        setContactId(contact.id)
        setContactVersion(contact.version)
      }

      const deal = await updateDeal(dealId, {
        version: dealVersion,
        name: dealName.trim(),
        amount: normalizeAmount(amount),
        contact_id: savedContactId,
        comment: emptyToNull(comment),
      })

      setDealVersion(deal.version)
      onClose()
      window.location.reload()
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Не удалось сохранить изменения.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const clearSaveError = () => {
    setSaveError('')
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
        aria-busy={isLoading || isSaving}
        tabIndex={-1}
      >
        <header className="edit-deal-modal__header">
          <h2 id="edit-deal-title">Редактировать сделку</h2>
          <button
            className="edit-deal-modal__close"
            type="button"
            aria-label="Закрыть окно"
            disabled={isSaving}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className="edit-deal-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="edit-deal-form__content">
            <EditFieldRow label="Название сделки">
              <input
                className="edit-deal-form__plain-input"
                type="text"
                value={dealName}
                maxLength={255}
                placeholder="Введите название"
                disabled={isLoading || isSaving}
                onChange={(event) => {
                  setDealName(event.target.value)
                  clearSaveError()
                }}
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
                  disabled={isLoading || isSaving}
                  onChange={(event) => {
                    setAmount(event.target.value.replace(/[^\d.,]/g, ''))
                    clearSaveError()
                  }}
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
                    disabled={isLoading || isSaving}
                    onChange={(event) => {
                      setContactName(event.target.value)
                      clearSaveError()
                    }}
                  />
                  <button
                    className="edit-deal-form__remove"
                    type="button"
                    aria-label="Убрать контакт"
                    title="Убрать контакт"
                    disabled={isLoading || isSaving}
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
                  disabled={isLoading || isSaving}
                  onChange={(event) => {
                    setCompany(event.target.value)
                    clearSaveError()
                  }}
                />
              </EditFieldRow>

              <EditFieldRow label="Телефон:">
                <input
                  className="edit-deal-form__plain-input"
                  type="tel"
                  value={phone}
                  maxLength={64}
                  placeholder="Введите номер"
                  disabled={isLoading || isSaving}
                  onChange={(event) => {
                    setPhone(event.target.value)
                    clearSaveError()
                  }}
                />
              </EditFieldRow>

              <EditFieldRow label="e-mail:">
                <input
                  className="edit-deal-form__plain-input"
                  type="email"
                  value={email}
                  maxLength={255}
                  placeholder="Введите e-mail"
                  disabled={isLoading || isSaving}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    clearSaveError()
                  }}
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
                  disabled={isLoading || isSaving}
                  onChange={(event) => {
                    setTelegram(event.target.value)
                    clearSaveError()
                  }}
                />
                <button
                  className="edit-deal-form__remove"
                  type="button"
                  aria-label="Убрать Telegram"
                  title="Убрать Telegram"
                  disabled={isLoading || isSaving}
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
                disabled={isLoading || isSaving || isMessengerOpen}
                onClick={() => {
                  setIsMessengerOpen(true)
                  clearSaveError()
                }}
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
                disabled={isLoading || isSaving}
                onChange={(event) => {
                  setComment(event.target.value)
                  clearSaveError()
                }}
              />
            </label>

            <button
              className="edit-deal-form__chat-button"
              type="button"
              title="Переход в чат будет добавлен позже"
              disabled
            >
              Перейти в чат
            </button>
          </div>

          {saveError && (
            <p className="edit-deal-form__error" role="alert">
              {saveError}
            </p>
          )}

          <button
            className="edit-deal-form__submit"
            type="submit"
            disabled={isLoading || isSaving || Boolean(loadError) || !dealName.trim()}
          >
            {isSaving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>

        {(isLoading || loadError) && (
          <div
            className={`edit-deal-modal__state${loadError ? ' edit-deal-modal__state--error' : ''}`}
            role={loadError ? 'alert' : 'status'}
          >
            {loadError || 'Загружаем данные сделки…'}
          </div>
        )}
      </div>
    </div>
  )
}

type EditFieldRowProps = {
  label: string
  children: ReactNode
}

function EditFieldRow({ label, children }: EditFieldRowProps) {
  return (
    <label className="edit-deal-form__row">
      <span>{label}</span>
      {children}
    </label>
  )
}

function getValidationError(data: {
  dealName: string
  amount: string
  contactName: string
  email: string
  telegram: string
}) {
  const normalizedDealName = data.dealName.trim()
  const normalizedAmount = data.amount.trim()
  const normalizedContactName = data.contactName.trim()
  const normalizedEmail = data.email.trim()
  const normalizedTelegram = data.telegram.trim()

  if (!normalizedDealName) {
    return 'Введите название сделки.'
  }

  if (normalizedAmount && !AMOUNT_PATTERN.test(normalizedAmount)) {
    return 'Введите сумму в формате 150000 или 150000,50.'
  }

  if (!normalizedContactName) {
    return 'Для сохранения сделки укажите ФИО контакта.'
  }

  if (!CONTACT_NAME_PATTERN.test(normalizedContactName)) {
    return 'ФИО должно содержать только буквы, пробелы и дефисы.'
  }

  if (normalizedEmail && !EMAIL_PATTERN.test(normalizedEmail)) {
    return 'Введите корректный e-mail.'
  }

  if (normalizedTelegram) {
    const username = normalizedTelegram.replace(/^@/, '')

    if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
      return 'Telegram должен содержать 5–32 латинских символа, цифры или _.'
    }
  }

  return ''
}

function emptyToNull(value: string) {
  const normalizedValue = value.trim()
  return normalizedValue || null
}

function normalizeAmount(value: string) {
  const normalizedValue = value.trim().replace(',', '.')
  return normalizedValue || null
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
