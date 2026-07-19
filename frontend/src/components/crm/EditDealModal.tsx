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
  searchContacts,
  type ApiContactAutocomplete,
} from '../../shared/api/contactsApi'
import { getDeal, updateDeal } from '../../shared/api/dealsApi'
import './EditDealModal.css'
import './EditDealModalState.css'

type EditDealModalProps = {
  dealId: string
  dealName: string
  onClose: () => void
}

type ContactSearchState = 'idle' | 'loading' | 'success' | 'error'

const CONTACT_NAME_PATTERN = /^[A-Za-zА-Яа-яЁё\- ]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/
const CONTACT_SEARCH_DELAY = 300

export function EditDealModal({
  dealId,
  dealName: initialDealName,
  onClose,
}: EditDealModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const contactNameInputRef = useRef<HTMLInputElement | null>(null)
  const [dealName, setDealName] = useState(initialDealName)
  const [amount, setAmount] = useState('')
  const [contactName, setContactName] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [telegram, setTelegram] = useState('')
  const [comment, setComment] = useState('')
  const [dealVersion, setDealVersion] = useState<number | null>(null)
  const [selectedContact, setSelectedContact] =
    useState<ApiContactAutocomplete | null>(null)
  const [contactSuggestions, setContactSuggestions] =
    useState<ApiContactAutocomplete[]>([])
  const [contactSearchState, setContactSearchState] =
    useState<ContactSearchState>('idle')
  const [contactSearchError, setContactSearchError] = useState('')
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

        const autocompleteContact = contact
          ? {
              id: contact.id,
              name: contact.name,
              company: contact.company,
              phone: contact.phone,
              email: contact.email,
              telegram: contact.telegram,
            }
          : null

        setDealName(deal.name)
        setAmount(deal.amount ?? '')
        setDealVersion(deal.version)
        setSelectedContact(autocompleteContact)
        setContactName(contact?.name ?? '')
        setCompany(contact?.company ?? '')
        setPhone(contact?.phone ?? '')
        setEmail(contact?.email ?? '')
        setTelegram(contact?.telegram ?? '')
        setComment(deal.comment ?? '')
        setIsMessengerOpen(Boolean(contact?.telegram))
        setContactSuggestions([])
        setContactSearchState('idle')
        setContactSearchError('')
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

  useEffect(() => {
    const query = contactName.trim()

    if (isLoading || selectedContact || query.length < 2) {
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
  }, [contactName, isLoading, selectedContact])

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
    setSaveError('')
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
    setSaveError('')

    window.setTimeout(() => contactNameInputRef.current?.focus(), 0)
  }

  const removeMessenger = () => {
    if (selectedContact) {
      return
    }

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
      company,
      phone,
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

      const hasContactData = [contactName, company, phone, email, telegram]
        .some((value) => value.trim())

      let savedContactId = selectedContact?.id ?? null

      if (!savedContactId && hasContactData) {
        const contact = await createContact({
          name: contactName.trim(),
          company: emptyToNull(company),
          phone: emptyToNull(phone),
          email: emptyToNull(email.toLowerCase()),
          telegram: emptyToNull(telegram),
        })
        savedContactId = contact.id
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

  const contactQuery = contactName.trim()
  const isContactSearchOpen =
    !selectedContact &&
    contactQuery.length >= 2 &&
    contactSearchState !== 'idle'
  const isFormBusy = isLoading || isSaving
  const areContactFieldsLocked = isFormBusy || Boolean(selectedContact)

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
        aria-busy={isFormBusy}
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
                disabled={isFormBusy}
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
                  disabled={isFormBusy}
                  onChange={(event) => {
                    setAmount(event.target.value.replace(/[^\d.,]/g, ''))
                    clearSaveError()
                  }}
                />
                <span>₽</span>
              </div>
            </EditFieldRow>

            <div className="edit-deal-form__contact-block">
              <div className="edit-deal-form__row">
                <label htmlFor="edit-deal-contact-name">ФИО</label>
                <div className="edit-deal-form__contact-search">
                  <div
                    className={`edit-deal-form__contact-input-wrap${
                      selectedContact
                        ? ' edit-deal-form__contact-input-wrap--selected'
                        : ''
                    }`}
                  >
                    <input
                      ref={contactNameInputRef}
                      id="edit-deal-contact-name"
                      className={`edit-deal-form__contact-input${
                        selectedContact
                          ? ' edit-deal-form__contact-input--selected'
                          : ''
                      }`}
                      type="text"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={isContactSearchOpen}
                      aria-controls="edit-deal-contact-options"
                      value={contactName}
                      maxLength={100}
                      placeholder="Введите ФИО"
                      disabled={areContactFieldsLocked}
                      onChange={(event) => {
                        setContactName(event.target.value)
                        clearSaveError()
                      }}
                    />

                    {selectedContact && (
                      <button
                        className="edit-deal-form__remove"
                        type="button"
                        aria-label="Выбрать другой контакт"
                        title="Выбрать другой контакт"
                        disabled={isFormBusy}
                        onClick={handleContactCleared}
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {isContactSearchOpen && (
                    <div
                      id="edit-deal-contact-options"
                      className="edit-deal-form__contact-options"
                      role="listbox"
                      aria-label="Найденные контакты"
                    >
                      {contactSearchState === 'loading' && (
                        <p className="edit-deal-form__contact-status">
                          Ищем контакты…
                        </p>
                      )}

                      {contactSearchState === 'error' && (
                        <p className="edit-deal-form__contact-status edit-deal-form__contact-status--error">
                          {contactSearchError}
                        </p>
                      )}

                      {contactSearchState === 'success' &&
                        contactSuggestions.length === 0 && (
                          <p className="edit-deal-form__contact-status">
                            Совпадений не найдено. Будет создан новый контакт.
                          </p>
                        )}

                      {contactSearchState === 'success' &&
                        contactSuggestions.map((contact) => (
                          <button
                            className="edit-deal-form__contact-option"
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

              <EditFieldRow label="Компания">
                <input
                  className="edit-deal-form__plain-input"
                  type="text"
                  value={company}
                  maxLength={100}
                  placeholder="Введите название"
                  disabled={areContactFieldsLocked}
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
                  disabled={areContactFieldsLocked}
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
                  disabled={areContactFieldsLocked}
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
                  disabled={areContactFieldsLocked}
                  onChange={(event) => {
                    setTelegram(event.target.value)
                    clearSaveError()
                  }}
                />
                {!selectedContact && (
                  <button
                    className="edit-deal-form__remove"
                    type="button"
                    aria-label="Убрать Telegram"
                    title="Убрать Telegram"
                    disabled={isFormBusy}
                    onClick={removeMessenger}
                  >
                    ×
                  </button>
                )}
              </div>
            )}

            <div className="edit-deal-form__messenger-block">
              <button
                className="edit-deal-form__messenger-button"
                type="button"
                title={
                  selectedContact
                    ? 'Мессенджер существующего контакта изменяется в разделе «Контакты»'
                    : undefined
                }
                disabled={areContactFieldsLocked || isMessengerOpen}
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
                disabled={isFormBusy}
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
            disabled={isFormBusy || Boolean(loadError) || !dealName.trim()}
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
