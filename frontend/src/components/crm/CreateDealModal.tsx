import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  createContact,
  searchContacts,
  type ApiContactAutocomplete,
} from '../../shared/api/contactsApi'
import {
  createDeal,
  type ApiKanbanDeal,
} from '../../shared/api/dealsApi'
import './CreateDealModal.css'

type CreateDealModalProps = {
  onClose: () => void
  onCreated: (deal: ApiKanbanDeal) => void
}

type ContactSearchState = 'idle' | 'loading' | 'success' | 'error'

const CONTACT_NAME_PATTERN = /^[A-Za-zА-Яа-яЁё\- ]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/
const CONTACT_SEARCH_DELAY = 300

export function CreateDealModal({ onClose, onCreated }: CreateDealModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const contactNameInputRef = useRef<HTMLInputElement | null>(null)
  const [dealName, setDealName] = useState('')
  const [amount, setAmount] = useState('')
  const [contactName, setContactName] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [telegram, setTelegram] = useState('')
  const [comment, setComment] = useState('')
  const [selectedContact, setSelectedContact] =
    useState<ApiContactAutocomplete | null>(null)
  const [contactSuggestions, setContactSuggestions] =
    useState<ApiContactAutocomplete[]>([])
  const [contactSearchState, setContactSearchState] =
    useState<ContactSearchState>('idle')
  const [contactSearchError, setContactSearchError] = useState('')
  const [isMessengerOpen, setIsMessengerOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

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

  useEffect(() => {
    const query = contactName.trim()

    if (selectedContact || query.length < 2) {
      setContactSuggestions([])
      setContactSearchState('idle')
      setContactSearchError('')
      return
    }

    let isCurrentSearch = true
    setContactSearchState('loading')
    setContactSearchError('')

    const timeoutId = window.setTimeout(() => {
      void searchContacts(query)
        .then((contacts) => {
          if (!isCurrentSearch) {
            return
          }

          setContactSuggestions(contacts)
          setContactSearchState('success')
        })
        .catch((requestError) => {
          if (!isCurrentSearch) {
            return
          }

          setContactSuggestions([])
          setContactSearchState('error')
          setContactSearchError(
            requestError instanceof Error
              ? requestError.message
              : 'Не удалось найти контакты.',
          )
        })
    }, CONTACT_SEARCH_DELAY)

    return () => {
      isCurrentSearch = false
      window.clearTimeout(timeoutId)
    }
  }, [contactName, selectedContact])

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

  const handleContactSelected = (contact: ApiContactAutocomplete) => {
    setSelectedContact(contact)
    setContactName(contact.name)
    setCompany(contact.company ?? '')
    setPhone(contact.phone ?? '')
    setEmail(contact.email ?? '')
    setTelegram(contact.telegram ?? '')
    setIsMessengerOpen(Boolean(contact.telegram))
    setContactSuggestions([])
    setContactSearchState('idle')
    setContactSearchError('')
    setError('')
  }

  const handleContactCleared = () => {
    setSelectedContact(null)
    setContactName('')
    setCompany('')
    setPhone('')
    setEmail('')
    setTelegram('')
    setIsMessengerOpen(false)
    setContactSuggestions([])
    setContactSearchState('idle')
    setContactSearchError('')
    setError('')

    window.setTimeout(() => contactNameInputRef.current?.focus(), 0)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isSaving) {
      return
    }

    const validationError = getValidationError({
      dealName,
      amount,
      contactName,
      company,
      phone,
      email,
      telegram,
    })

    if (validationError) {
      setError(validationError)
      return
    }

    try {
      setIsSaving(true)
      setError('')

      const hasContactData = [contactName, company, phone, email, telegram]
        .some((value) => value.trim())

      let contactId = selectedContact?.id ?? null

      if (!contactId && hasContactData) {
        const contact = await createContact({
          name: contactName.trim(),
          company: emptyToNull(company),
          phone: emptyToNull(phone),
          email: emptyToNull(email.toLowerCase()),
          telegram: emptyToNull(telegram),
        })
        contactId = contact.id
      }

      const deal = await createDeal({
        name: dealName.trim(),
        amount: normalizeAmount(amount),
        currency: 'RUB',
        contact_id: contactId,
        comment: emptyToNull(comment),
      })

      onCreated(deal)
      onClose()
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось создать сделку.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const contactQuery = contactName.trim()
  const isContactSearchOpen =
    !selectedContact &&
    contactQuery.length >= 2 &&
    contactSearchState !== 'idle'
  const areContactFieldsLocked = isSaving || Boolean(selectedContact)

  return (
    <div
      className="create-deal-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={modalRef}
        className="create-deal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-deal-title"
        tabIndex={-1}
      >
        <header className="create-deal-modal__header">
          <h2 id="create-deal-title">Создать сделку</h2>
          <button
            className="create-deal-modal__close"
            type="button"
            aria-label="Закрыть окно"
            disabled={isSaving}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className="create-deal-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="create-deal-form__main">
            <FieldRow label="Название сделки">
              <input
                className="create-deal-form__plain-input"
                type="text"
                value={dealName}
                maxLength={255}
                placeholder="Введите название"
                disabled={isSaving}
                onChange={(event) => {
                  setDealName(event.target.value)
                  setError('')
                }}
              />
            </FieldRow>

            <FieldRow label="Сделка на сумму">
              <input
                className="create-deal-form__amount-input"
                type="text"
                inputMode="decimal"
                value={amount}
                maxLength={18}
                aria-label="Сумма сделки"
                disabled={isSaving}
                onChange={(event) => {
                  setAmount(event.target.value.replace(/[^\d.,]/g, ''))
                  setError('')
                }}
              />
            </FieldRow>

            <div className="create-deal-form__contact-block">
              <div className="create-deal-form__row">
                <label htmlFor="create-deal-contact-name">ФИО</label>
                <div className="create-deal-form__contact-search">
                  <input
                    ref={contactNameInputRef}
                    id="create-deal-contact-name"
                    className={`create-deal-form__plain-input${
                      selectedContact
                        ? ' create-deal-form__plain-input--selected'
                        : ''
                    }`}
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={isContactSearchOpen}
                    aria-controls="create-deal-contact-options"
                    value={contactName}
                    maxLength={100}
                    placeholder="Введите ФИО"
                    disabled={areContactFieldsLocked}
                    onChange={(event) => {
                      setContactName(event.target.value)
                      setError('')
                    }}
                  />

                  {selectedContact && (
                    <button
                      className="create-deal-form__contact-clear"
                      type="button"
                      aria-label="Выбрать другой контакт"
                      title="Выбрать другой контакт"
                      disabled={isSaving}
                      onClick={handleContactCleared}
                    >
                      ×
                    </button>
                  )}

                  {isContactSearchOpen && (
                    <div
                      id="create-deal-contact-options"
                      className="create-deal-form__contact-options"
                      role="listbox"
                      aria-label="Найденные контакты"
                    >
                      {contactSearchState === 'loading' && (
                        <p className="create-deal-form__contact-status">
                          Ищем контакты…
                        </p>
                      )}

                      {contactSearchState === 'error' && (
                        <p className="create-deal-form__contact-status create-deal-form__contact-status--error">
                          {contactSearchError}
                        </p>
                      )}

                      {contactSearchState === 'success' &&
                        contactSuggestions.length === 0 && (
                          <p className="create-deal-form__contact-status">
                            Совпадений не найдено. Будет создан новый контакт.
                          </p>
                        )}

                      {contactSearchState === 'success' &&
                        contactSuggestions.map((contact) => (
                          <button
                            className="create-deal-form__contact-option"
                            type="button"
                            role="option"
                            aria-selected="false"
                            key={contact.id}
                            onClick={() => handleContactSelected(contact)}
                          >
                            <strong>{contact.name}</strong>
                            <span>{getContactSummary(contact)}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              <FieldRow label="Компания">
                <input
                  className="create-deal-form__plain-input"
                  type="text"
                  value={company}
                  maxLength={100}
                  placeholder="Введите название"
                  disabled={areContactFieldsLocked}
                  onChange={(event) => {
                    setCompany(event.target.value)
                    setError('')
                  }}
                />
              </FieldRow>

              <FieldRow label="Телефон:">
                <input
                  className="create-deal-form__plain-input"
                  type="tel"
                  value={phone}
                  maxLength={64}
                  placeholder="Введите номер"
                  disabled={areContactFieldsLocked}
                  onChange={(event) => {
                    setPhone(event.target.value)
                    setError('')
                  }}
                />
              </FieldRow>

              <FieldRow label="e-mail:">
                <input
                  className="create-deal-form__plain-input"
                  type="email"
                  value={email}
                  maxLength={255}
                  placeholder="Введите e-mail"
                  disabled={areContactFieldsLocked}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setError('')
                  }}
                />
              </FieldRow>
            </div>

            <div className="create-deal-form__divider" />

            <div className="create-deal-form__messenger-block">
              <button
                className="create-deal-form__messenger-button"
                type="button"
                disabled={areContactFieldsLocked}
                onClick={() => setIsMessengerOpen((isOpen) => !isOpen)}
              >
                {isMessengerOpen ? 'Убрать мессенджер' : 'Добавить мессенджер'}
              </button>

              {isMessengerOpen && (
                <FieldRow label="Telegram:">
                  <input
                    className="create-deal-form__plain-input"
                    type="text"
                    value={telegram}
                    maxLength={64}
                    placeholder="@username"
                    disabled={areContactFieldsLocked}
                    onChange={(event) => {
                      setTelegram(event.target.value)
                      setError('')
                    }}
                  />
                </FieldRow>
              )}
            </div>

            <div className="create-deal-form__divider" />

            <label className="create-deal-form__comment">
              <span>Комментарий:</span>
              <textarea
                value={comment}
                maxLength={500}
                placeholder="Написать..."
                disabled={isSaving}
                onChange={(event) => {
                  setComment(event.target.value)
                  setError('')
                }}
              />
            </label>

            <button
              className="create-deal-form__chat-button"
              type="button"
              title="Переход в чат будет добавлен позже"
              disabled
            >
              Перейти в чат
            </button>
          </div>

          {error && (
            <p className="create-deal-form__error" role="alert">
              {error}
            </p>
          )}

          <button
            className="create-deal-form__submit"
            type="submit"
            disabled={isSaving || !dealName.trim()}
          >
            {isSaving ? 'Создаём…' : 'Создать сделку'}
          </button>
        </form>
      </div>
    </div>
  )
}

type FieldRowProps = {
  label: string
  children: React.ReactNode
}

function FieldRow({ label, children }: FieldRowProps) {
  return (
    <label className="create-deal-form__row">
      <span>{label}</span>
      {children}
    </label>
  )
}

function getContactSummary(contact: ApiContactAutocomplete) {
  const details = [contact.company, contact.phone, contact.email]
    .filter((value): value is string => Boolean(value))

  return details.join(' · ') || 'Контакт без дополнительных данных'
}

function getValidationError(data: {
  dealName: string
  amount: string
  contactName: string
  company: string
  phone: string
  email: string
  telegram: string
}) {
  const normalizedDealName = data.dealName.trim()
  const normalizedAmount = data.amount.trim()
  const normalizedContactName = data.contactName.trim()
  const normalizedEmail = data.email.trim()
  const normalizedTelegram = data.telegram.trim()
  const hasContactData = [
    data.contactName,
    data.company,
    data.phone,
    data.email,
    data.telegram,
  ].some((value) => value.trim())

  if (!normalizedDealName) {
    return 'Введите название сделки.'
  }

  if (normalizedDealName.length > 255) {
    return 'Название сделки должно содержать не больше 255 символов.'
  }

  if (normalizedAmount && !AMOUNT_PATTERN.test(normalizedAmount)) {
    return 'Введите сумму в формате 150000 или 150000,50.'
  }

  if (hasContactData && !normalizedContactName) {
    return 'Для сохранения контакта укажите ФИО.'
  }

  if (normalizedContactName && !CONTACT_NAME_PATTERN.test(normalizedContactName)) {
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
