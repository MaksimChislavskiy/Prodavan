import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  createContact,
  searchContacts,
  type ApiContactAutocomplete,
  type CreateContactRequest,
} from '../../shared/api/contactsApi'
import {
  createDeal,
  createDealIdempotencyKey,
  type ApiKanbanDeal,
  type CreateDealRequest,
} from '../../shared/api/dealsApi'
import { showCrmToast } from '../../shared/crmToast'
import './CreateDealModal.css'
import './CreateDealModalV2.css'

type CreateDealModalProps = {
  onClose: () => void
  onCreated: (deal: ApiKanbanDeal) => void
}

type ContactSearchState = 'idle' | 'loading' | 'success' | 'error'

type FormErrors = Partial<
  Record<'dealName' | 'amount' | 'contactName' | 'phone' | 'email' | 'telegram', string>
>

const CONTACT_NAME_PATTERN = /^[A-Za-zА-Яа-яЁё\- ]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TELEGRAM_PATTERN = /^[A-Za-z0-9_]{5,32}$/
const CONTACT_SEARCH_DELAY = 300
const MAX_AMOUNT = 9_999_999_999_999.99

export function CreateDealModal({ onClose, onCreated }: CreateDealModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const firstInputRef = useRef<HTMLInputElement | null>(null)
  const contactInputRef = useRef<HTMLInputElement | null>(null)
  const searchControllerRef = useRef<AbortController | null>(null)
  const saveControllerRef = useRef<AbortController | null>(null)
  const idempotencyRef = useRef({
    payload: '',
    key: createDealIdempotencyKey(),
  })
  const createdContactRef = useRef<{ signature: string; id: string } | null>(null)

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
  const [activeContactIndex, setActiveContactIndex] = useState(0)
  const [isContactSearchOpen, setIsContactSearchOpen] = useState(false)
  const [isMessengerOpen, setIsMessengerOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)

  const isDirty = useMemo(
    () =>
      JSON.stringify({
        dealName: dealName.trim(),
        amount: normalizeAmount(amount),
        contactName: contactName.trim(),
        company: company.trim(),
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
        telegram: isMessengerOpen ? telegram.trim() : '',
        comment: comment.trim(),
        selectedContactId: selectedContact?.id ?? null,
        isMessengerOpen,
      }) !==
      JSON.stringify({
        dealName: '',
        amount: null,
        contactName: '',
        company: '',
        phone: '',
        email: '',
        telegram: '',
        comment: '',
        selectedContactId: null,
        isMessengerOpen: false,
      }),
    [
      amount,
      comment,
      company,
      contactName,
      dealName,
      email,
      isMessengerOpen,
      phone,
      selectedContact?.id,
      telegram,
    ],
  )

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timeoutId = window.setTimeout(() => firstInputRef.current?.focus(), 0)

    return () => {
      document.body.style.overflow = originalOverflow
      window.clearTimeout(timeoutId)
      searchControllerRef.current?.abort()
      saveControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const query = contactName.trim()

    searchControllerRef.current?.abort()
    searchControllerRef.current = null

    if (selectedContact || query.length < 2) {
      setContactSuggestions([])
      setContactSearchState('idle')
      setContactSearchError('')
      setIsContactSearchOpen(false)
      return
    }

    setContactSearchState('loading')
    setContactSearchError('')
    setIsContactSearchOpen(true)

    const controller = new AbortController()
    searchControllerRef.current = controller
    const timeoutId = window.setTimeout(() => {
      void searchContacts(query, 5, controller.signal)
        .then((contacts) => {
          if (controller.signal.aborted) {
            return
          }

          setContactSuggestions(contacts)
          setActiveContactIndex(0)
          setContactSearchState('success')
          setIsContactSearchOpen(contacts.length > 0)
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return
          }

          setContactSuggestions([])
          setContactSearchState('error')
          setContactSearchError(
            error instanceof Error ? error.message : 'Не удалось найти контакты.',
          )
          setIsContactSearchOpen(true)
        })
    }, CONTACT_SEARCH_DELAY)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
      if (searchControllerRef.current === controller) {
        searchControllerRef.current = null
      }
    }
  }, [contactName, selectedContact])

  const clearErrors = () => {
    setRequestError('')
    setFormErrors({})
  }

  const closeImmediately = () => {
    searchControllerRef.current?.abort()
    saveControllerRef.current?.abort()
    onClose()
  }

  const requestClose = () => {
    if (isSaving) {
      return
    }

    if (isDirty) {
      setIsCloseConfirmOpen(true)
      return
    }

    closeImmediately()
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      requestClose()
    }
  }

  const handleModalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !isSaving && !isCloseConfirmOpen) {
      event.preventDefault()
      requestClose()
      return
    }

    if (event.key !== 'Tab' || !modalRef.current) {
      return
    }

    const focusable = Array.from(
      modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
      ),
    )

    if (focusable.length === 0) {
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleContactNameChange = (value: string) => {
    if (selectedContact) {
      setSelectedContact(null)
    }

    setContactName(value)
    setContactSuggestions([])
    setActiveContactIndex(0)
    clearErrors()
    createdContactRef.current = null
  }

  const selectContact = (contact: ApiContactAutocomplete) => {
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
    setIsContactSearchOpen(false)
    setActiveContactIndex(0)
    clearErrors()
    createdContactRef.current = null
  }

  const clearSelectedContact = () => {
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
    setIsContactSearchOpen(false)
    setActiveContactIndex(0)
    clearErrors()
    createdContactRef.current = null
    window.setTimeout(() => contactInputRef.current?.focus(), 0)
  }

  const handleContactKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && isContactSearchOpen) {
      event.preventDefault()
      event.stopPropagation()
      setIsContactSearchOpen(false)
      return
    }

    if (contactSuggestions.length === 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      setIsContactSearchOpen(true)
      setActiveContactIndex((index) =>
        Math.min(index + 1, contactSuggestions.length - 1),
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setIsContactSearchOpen(true)
      setActiveContactIndex((index) => Math.max(index - 1, 0))
      return
    }

    if (event.key === 'Enter' && isContactSearchOpen) {
      const contact = contactSuggestions[activeContactIndex]
      if (contact) {
        event.preventDefault()
        event.stopPropagation()
        selectContact(contact)
      }
    }
  }

  const handleAmountChange = (value: string) => {
    const normalized = value.replace(',', '.')

    if (normalized === '' || /^\d{0,13}(?:\.\d{0,2})?$/.test(normalized)) {
      setAmount(normalized)
      clearErrors()
    }
  }

  const addMessenger = () => {
    if (selectedContact) {
      return
    }

    setIsMessengerOpen(true)
    setTelegram((value) => value || '@')
    clearErrors()
  }

  const removeMessenger = () => {
    if (selectedContact) {
      return
    }

    setTelegram('')
    setIsMessengerOpen(false)
    clearErrors()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isSaving) {
      return
    }

    const validation = validateForm({
      dealName,
      amount,
      contactName,
      phone,
      email,
      telegram: isMessengerOpen ? telegram : '',
    })

    if (Object.keys(validation.errors).length > 0) {
      setFormErrors(validation.errors)
      setRequestError('')
      return
    }

    const normalizedContact: CreateContactRequest = {
      name: contactName.trim(),
      company: emptyToNull(company),
      phone: validation.normalizedPhone,
      email: emptyToNull(email.toLowerCase()),
      telegram: isMessengerOpen ? validation.normalizedTelegram : null,
    }
    const contactSignature = JSON.stringify(normalizedContact)

    const controller = new AbortController()
    saveControllerRef.current?.abort()
    saveControllerRef.current = controller
    setIsSaving(true)
    setFormErrors({})
    setRequestError('')

    try {
      let contactId = selectedContact?.id ?? null

      if (!contactId) {
        if (createdContactRef.current?.signature === contactSignature) {
          contactId = createdContactRef.current.id
        } else {
          const contact = await createContact(normalizedContact, controller.signal)
          contactId = contact.id
          createdContactRef.current = {
            signature: contactSignature,
            id: contact.id,
          }
        }
      }

      const dealPayload: CreateDealRequest = {
        name: dealName.trim(),
        amount: normalizeAmount(amount),
        currency: 'RUB',
        contact_id: contactId,
        comment: emptyToNull(comment),
      }
      const serializedPayload = JSON.stringify(dealPayload)

      if (idempotencyRef.current.payload !== serializedPayload) {
        idempotencyRef.current = {
          payload: serializedPayload,
          key: createDealIdempotencyKey(),
        }
      }

      const deal = await createDeal(
        dealPayload,
        idempotencyRef.current.key,
        controller.signal,
      )

      onCreated(deal)
      showCrmToast('Сделка успешно создана')
      closeImmediately()
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      setRequestError(
        error instanceof Error
          ? error.message
          : 'Не удалось сохранить сделку. Попробуйте позже',
      )
    } finally {
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null
      }
      setIsSaving(false)
    }
  }

  const isContactDetailsLocked = isSaving || Boolean(selectedContact)

  return createPortal(
    <>
      <div
        className="create-deal-overlay"
        role="presentation"
        onMouseDown={handleOverlayMouseDown}
      >
        <div
          ref={modalRef}
          className="create-deal-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-deal-title"
          aria-busy={isSaving}
          tabIndex={-1}
          onKeyDown={handleModalKeyDown}
        >
          <header className="create-deal-modal__header">
            <h2 id="create-deal-title">Добавление сделки</h2>
            <button
              className="create-deal-modal__close"
              type="button"
              aria-label="Закрыть"
              disabled={isSaving}
              onClick={requestClose}
            >
              ×
            </button>
          </header>

          <form
            className="create-deal-form"
            noValidate
            onSubmit={(submitEvent) => void handleSubmit(submitEvent)}
          >
            <div className="create-deal-form__main">
              <FieldRow label="Название сделки">
                <input
                  ref={firstInputRef}
                  className="create-deal-form__plain-input"
                  type="text"
                  value={dealName}
                  maxLength={255}
                  placeholder="Введите название"
                  disabled={isSaving}
                  aria-invalid={Boolean(formErrors.dealName)}
                  onChange={(event) => {
                    setDealName(event.target.value)
                    clearErrors()
                  }}
                />
                <FieldError>{formErrors.dealName}</FieldError>
              </FieldRow>

              <FieldRow label="Сделка на сумму">
                <input
                  className="create-deal-form__amount-input"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  maxLength={16}
                  placeholder="0"
                  aria-label="Сумма сделки"
                  aria-invalid={Boolean(formErrors.amount)}
                  disabled={isSaving}
                  onChange={(event) => handleAmountChange(event.target.value)}
                />
                <FieldError>{formErrors.amount}</FieldError>
              </FieldRow>

              <div className="create-deal-form__contact-block">
                <div className="create-deal-form__row">
                  <label htmlFor="create-deal-contact-name">ФИО</label>
                  <div className="create-deal-form__contact-search">
                    <input
                      ref={contactInputRef}
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
                      aria-activedescendant={
                        isContactSearchOpen && contactSuggestions[activeContactIndex]
                          ? `create-deal-contact-${contactSuggestions[activeContactIndex].id}`
                          : undefined
                      }
                      aria-invalid={Boolean(formErrors.contactName)}
                      value={contactName}
                      maxLength={100}
                      placeholder="Введите ФИО"
                      disabled={isSaving}
                      onChange={(event) => handleContactNameChange(event.target.value)}
                      onKeyDown={handleContactKeyDown}
                      onFocus={() => {
                        if (contactSuggestions.length > 0 || contactSearchState === 'error') {
                          setIsContactSearchOpen(true)
                        }
                      }}
                      onBlur={() => {
                        window.setTimeout(() => setIsContactSearchOpen(false), 120)
                      }}
                    />

                    {selectedContact && (
                      <button
                        className="create-deal-form__contact-clear"
                        type="button"
                        aria-label="Отвязать контакт"
                        title="Отвязать контакт"
                        disabled={isSaving}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={clearSelectedContact}
                      >
                        ×
                      </button>
                    )}

                    {contactSearchState === 'loading' && !selectedContact && (
                      <span
                        className="create-deal-v2__search-spinner"
                        role="status"
                        aria-label="Поиск контактов"
                      />
                    )}

                    {isContactSearchOpen && (
                      <div
                        id="create-deal-contact-options"
                        className="create-deal-form__contact-options"
                        role="listbox"
                        aria-label="Найденные контакты"
                      >
                        {contactSearchState === 'error' ? (
                          <p className="create-deal-form__contact-status create-deal-form__contact-status--error">
                            {contactSearchError}
                          </p>
                        ) : (
                          contactSuggestions.map((contact, index) => (
                            <button
                              id={`create-deal-contact-${contact.id}`}
                              className={`create-deal-form__contact-option${
                                index === activeContactIndex ? ' is-active' : ''
                              }`}
                              type="button"
                              role="option"
                              aria-selected={index === activeContactIndex}
                              key={contact.id}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setActiveContactIndex(index)}
                              onClick={() => selectContact(contact)}
                            >
                              <strong>{contact.name}</strong>
                              <span>{getContactSummary(contact)}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    <FieldError>{formErrors.contactName}</FieldError>
                  </div>
                </div>

                <FieldRow label="Компания">
                  <input
                    className="create-deal-form__plain-input"
                    type="text"
                    value={company}
                    maxLength={100}
                    placeholder="Введите название"
                    disabled={isContactDetailsLocked}
                    onChange={(event) => {
                      setCompany(event.target.value)
                      clearErrors()
                      createdContactRef.current = null
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
                    disabled={isContactDetailsLocked}
                    aria-invalid={Boolean(formErrors.phone)}
                    onChange={(event) => {
                      setPhone(event.target.value)
                      clearErrors()
                      createdContactRef.current = null
                    }}
                  />
                  <FieldError>{formErrors.phone}</FieldError>
                </FieldRow>

                <FieldRow label="e-mail:">
                  <input
                    className="create-deal-form__plain-input"
                    type="email"
                    value={email}
                    maxLength={255}
                    placeholder="Введите e-mail"
                    disabled={isContactDetailsLocked}
                    aria-invalid={Boolean(formErrors.email)}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      clearErrors()
                      createdContactRef.current = null
                    }}
                  />
                  <FieldError>{formErrors.email}</FieldError>
                </FieldRow>
              </div>

              <div className="create-deal-form__divider" />

              <div className="create-deal-form__messenger-block">
                {!isMessengerOpen && (
                  <button
                    className="create-deal-form__messenger-button"
                    type="button"
                    disabled={isContactDetailsLocked}
                    onClick={addMessenger}
                  >
                    Добавить мессенджер
                  </button>
                )}

                {isMessengerOpen && (
                  <div className="create-deal-v2__telegram-row">
                    <FieldRow label="Telegram:">
                      <input
                        className="create-deal-form__plain-input"
                        type="text"
                        value={telegram}
                        maxLength={64}
                        placeholder="@username"
                        disabled={isContactDetailsLocked}
                        aria-invalid={Boolean(formErrors.telegram)}
                        onChange={(event) => {
                          setTelegram(event.target.value)
                          clearErrors()
                          createdContactRef.current = null
                        }}
                      />
                      <FieldError>{formErrors.telegram}</FieldError>
                    </FieldRow>
                    {!selectedContact && (
                      <button
                        className="create-deal-v2__telegram-remove"
                        type="button"
                        aria-label="Удалить Telegram"
                        title="Удалить Telegram"
                        disabled={isSaving}
                        onClick={removeMessenger}
                      >
                        ×
                      </button>
                    )}
                  </div>
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
                    clearErrors()
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

            {requestError && (
              <p className="create-deal-form__error" role="alert">
                {requestError}
              </p>
            )}

            <button
              className="create-deal-form__submit"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? 'Сохраняем…' : 'Добавить сделку'}
            </button>
          </form>
        </div>
      </div>

      {isCloseConfirmOpen && (
        <div className="create-deal-v2__confirm-overlay" role="presentation">
          <div
            className="create-deal-v2__confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="create-deal-close-title"
          >
            <h3 id="create-deal-close-title">Закрыть окно?</h3>
            <p>
              Вы действительно хотите закрыть окно? Все несохранённые изменения будут потеряны.
            </p>
            <div>
              <button type="button" onClick={() => setIsCloseConfirmOpen(false)}>
                Остаться
              </button>
              <button type="button" className="is-danger" onClick={closeImmediately}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="create-deal-form__row">
      <span>{label}</span>
      {children}
    </label>
  )
}

function FieldError({ children }: { children?: string }) {
  if (!children) {
    return null
  }

  return <em className="create-deal-v2__field-error">{children}</em>
}

function validateForm(data: {
  dealName: string
  amount: string
  contactName: string
  phone: string
  email: string
  telegram: string
}) {
  const errors: FormErrors = {}
  const name = data.dealName.trim()
  const contactName = data.contactName.trim()
  const email = data.email.trim()
  const amount = normalizeAmount(data.amount)
  let normalizedPhone: string | null = null
  let normalizedTelegram: string | null = null

  if (!name) {
    errors.dealName = 'Название сделки обязательно'
  } else if (name.length > 255) {
    errors.dealName = 'Название сделки должно содержать не больше 255 символов'
  }

  if (amount !== null) {
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      errors.amount = 'Сумма должна быть положительным числом (разделитель – точка)'
    } else if (numericAmount > MAX_AMOUNT) {
      errors.amount = 'Сумма не может превышать 9999999999999.99'
    }
  }

  if (!contactName) {
    errors.contactName = 'ФИО контакта обязательно'
  } else if (contactName.length > 100 || !CONTACT_NAME_PATTERN.test(contactName)) {
    errors.contactName = 'ФИО: 1–100 символов, только буквы, пробелы и дефисы'
  }

  if (data.phone.trim()) {
    try {
      normalizedPhone = normalizePhone(data.phone)
    } catch {
      errors.phone = 'Некорректный номер телефона'
    }
  }

  if (email && !EMAIL_PATTERN.test(email)) {
    errors.email = 'Введите корректный email'
  }

  if (data.telegram.trim()) {
    const username = data.telegram.replace(/@/g, '').trim()
    if (!TELEGRAM_PATTERN.test(username)) {
      errors.telegram =
        'Никнейм Telegram: 5–32 символа (латиница, цифры, _). Символ @ добавится автоматически'
    } else {
      normalizedTelegram = `@${username}`
    }
  }

  return { errors, normalizedPhone, normalizedTelegram }
}

function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s\-()]/g, '')

  if (!/^\+?\d+$/.test(compact) || compact.slice(1).includes('+')) {
    throw new Error('invalid phone')
  }

  let normalized = compact
  if (/^8\d{10}$/.test(normalized)) {
    normalized = `+7${normalized.slice(1)}`
  } else if (/^\d{10}$/.test(normalized)) {
    normalized = `+7${normalized}`
  }

  const digits = normalized.replace(/^\+/, '')
  if (digits.length < 7 || digits.length > 15) {
    throw new Error('invalid phone')
  }

  return normalized
}

function normalizeAmount(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) {
    return null
  }

  const [integerPart, fractionPart = ''] = normalized.split('.')
  return fractionPart
    ? `${integerPart}.${fractionPart.padEnd(2, '0')}`
    : `${integerPart}.00`
}

function emptyToNull(value: string) {
  const normalized = value.trim()
  return normalized || null
}

function getContactSummary(contact: ApiContactAutocomplete) {
  const details = [contact.company, contact.phone, contact.email]
    .filter((value): value is string => Boolean(value))
  return details.join(' · ') || 'Контакт без дополнительных данных'
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
