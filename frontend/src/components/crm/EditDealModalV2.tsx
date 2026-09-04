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
import { ApiError } from '../../shared/api/apiClient'
import {
  createContact,
  findContactByName,
  searchContacts,
  type ApiContactAutocomplete,
  type CreateContactRequest,
} from '../../shared/api/contactsApi'
import {
  getDeal,
  updateDeal,
  type ApiDealDetail,
  type UpdateDealRequest,
} from '../../shared/api/dealsApi'
import { showCrmToast } from '../../shared/crmToast'
import './CreateDealModal.css'
import './CreateDealModalV2.css'

type EditDealModalProps = {
  dealId: string
  dealName: string
  onClose: () => void
}

type ContactSearchState = 'idle' | 'loading' | 'success' | 'error'

type FormErrors = Partial<
  Record<'dealName' | 'amount' | 'contactName' | 'phone' | 'email' | 'telegram', string>
>

type ContactSnapshot = {
  name: string
  company: string
  phone: string
  email: string
  telegram: string
}

type DealSnapshot = {
  name: string
  amount: string | null
  comment: string | null
  contactId: string | null
  contact: ContactSnapshot
  messengerVisible: boolean
}

type PendingSave = {
  deal: Omit<UpdateDealRequest, 'version' | 'contact_id'>
  contact: CreateContactRequest
}

const CONTACT_NAME_PATTERN = /^[A-Za-zА-Яа-яЁё\- ]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TELEGRAM_PATTERN = /^[A-Za-z0-9_]{5,32}$/
const CONTACT_SEARCH_DELAY = 300
const MAX_AMOUNT = 9_999_999_999_999.99

export function EditDealModal({ dealId, dealName, onClose }: EditDealModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const firstInputRef = useRef<HTMLInputElement | null>(null)
  const contactInputRef = useRef<HTMLInputElement | null>(null)
  const searchControllerRef = useRef<AbortController | null>(null)
  const saveControllerRef = useRef<AbortController | null>(null)
  const createdContactRef = useRef<{ signature: string; id: string } | null>(null)

  const [currentDealName, setCurrentDealName] = useState(dealName)
  const [amount, setAmount] = useState('')
  const [contactName, setContactName] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [telegram, setTelegram] = useState('')
  const [comment, setComment] = useState('')
  const [version, setVersion] = useState<number | null>(null)
  const [originalContactId, setOriginalContactId] = useState<string | null>(null)
  const [originalContactSnapshot, setOriginalContactSnapshot] =
    useState<ContactSnapshot>(emptyContactSnapshot)
  const [initialSnapshot, setInitialSnapshot] = useState<DealSnapshot | null>(null)
  const [detachedFromOriginal, setDetachedFromOriginal] = useState(false)
  const [selectedContact, setSelectedContact] =
    useState<ApiContactAutocomplete | null>(null)
  const [contactSuggestions, setContactSuggestions] =
    useState<ApiContactAutocomplete[]>([])
  const [contactSearchState, setContactSearchState] =
    useState<ContactSearchState>('idle')
  const [contactSearchError, setContactSearchError] = useState('')
  const [activeContactIndex, setActiveContactIndex] = useState(0)
  const [isContactSearchOpen, setIsContactSearchOpen] = useState(false)
  const [contactSearchEnabled, setContactSearchEnabled] = useState(false)
  const [isMessengerOpen, setIsMessengerOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [isConflictOpen, setIsConflictOpen] = useState(false)
  const [duplicateContact, setDuplicateContact] =
    useState<ApiContactAutocomplete | null>(null)
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null)

  const currentContactSnapshot = useMemo(
    () => normalizeContactSnapshot({
      name: contactName,
      company,
      phone,
      email,
      telegram: isMessengerOpen ? telegram : '',
    }),
    [company, contactName, email, isMessengerOpen, phone, telegram],
  )

  const contactMatchesOriginal = useMemo(
    () => snapshotsEqual(currentContactSnapshot, originalContactSnapshot),
    [currentContactSnapshot, originalContactSnapshot],
  )

  const effectiveContactId = selectedContact?.id
    ?? (!detachedFromOriginal && contactMatchesOriginal ? originalContactId : null)

  const currentSnapshot = useMemo<DealSnapshot>(
    () => ({
      name: currentDealName.trim(),
      amount: normalizeAmount(amount),
      comment: emptyToNull(comment),
      contactId: effectiveContactId,
      contact: currentContactSnapshot,
      messengerVisible: isMessengerOpen,
    }),
    [
      amount,
      comment,
      currentContactSnapshot,
      currentDealName,
      effectiveContactId,
      isMessengerOpen,
    ],
  )

  const isDirty = Boolean(initialSnapshot)
    && !snapshotsEqual(currentSnapshot, initialSnapshot)

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const controller = new AbortController()

    void loadDeal(controller)

    return () => {
      document.body.style.overflow = originalOverflow
      controller.abort()
      searchControllerRef.current?.abort()
      saveControllerRef.current?.abort()
    }
  }, [dealId])

  useEffect(() => {
    const query = contactName.trim()

    searchControllerRef.current?.abort()
    searchControllerRef.current = null

    if (
      !contactSearchEnabled
      || selectedContact
      || isLoading
      || query.length < 2
    ) {
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
  }, [contactName, contactSearchEnabled, isLoading, selectedContact])

  async function loadDeal(controller: AbortController) {
    try {
      setIsLoading(true)
      setLoadError('')
      setRequestError('')
      const deal = await getDeal(dealId, controller.signal)

      if (controller.signal.aborted) {
        return
      }

      hydrateDeal(deal)
      setIsLoading(false)
      window.setTimeout(() => firstInputRef.current?.focus(), 0)
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      if (error instanceof ApiError && error.status === 404) {
        showCrmToast('Сделка была удалена другим пользователем')
        onClose()
        return
      }

      setLoadError(
        error instanceof Error ? error.message : 'Не удалось загрузить данные сделки.',
      )
      setIsLoading(false)
    }
  }

  const hydrateDeal = (deal: ApiDealDetail) => {
    const rawContact: ContactSnapshot = {
      name: deal.contact?.name ?? '',
      company: deal.contact?.company ?? '',
      phone: deal.contact?.phone ?? '',
      email: deal.contact?.email ?? '',
      telegram: deal.contact?.telegram ?? '',
    }
    const normalizedContact = normalizeContactSnapshot(rawContact)
    const messengerVisible = Boolean(deal.contact?.telegram)
    const snapshot: DealSnapshot = {
      name: deal.name.trim(),
      amount: normalizeAmount(deal.amount ?? ''),
      comment: emptyToNull(deal.comment ?? ''),
      contactId: deal.contact?.id ?? null,
      contact: normalizedContact,
      messengerVisible,
    }

    setCurrentDealName(deal.name)
    setAmount(deal.amount ?? '')
    setContactName(rawContact.name)
    setCompany(rawContact.company)
    setPhone(rawContact.phone)
    setEmail(rawContact.email)
    setTelegram(rawContact.telegram)
    setComment(deal.comment ?? '')
    setVersion(deal.version)
    setOriginalContactId(deal.contact?.id ?? null)
    setOriginalContactSnapshot(normalizedContact)
    setInitialSnapshot(snapshot)
    setDetachedFromOriginal(false)
    setSelectedContact(null)
    setIsMessengerOpen(messengerVisible)
    setContactSearchEnabled(false)
    setContactSuggestions([])
    setContactSearchState('idle')
    setContactSearchError('')
    setIsContactSearchOpen(false)
    setActiveContactIndex(0)
    setFormErrors({})
    setRequestError('')
    setPendingSave(null)
    setDuplicateContact(null)
    setIsConflictOpen(false)
    createdContactRef.current = null
  }

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
    if (
      event.key === 'Escape'
      && !isSaving
      && !isCloseConfirmOpen
      && !isConflictOpen
      && !duplicateContact
    ) {
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

  const markManualContactEdit = () => {
    if (selectedContact) {
      setSelectedContact(null)
      setDetachedFromOriginal(true)
    }
    createdContactRef.current = null
  }

  const handleContactNameChange = (value: string) => {
    markManualContactEdit()
    setContactName(value)
    setContactSearchEnabled(true)
    setContactSuggestions([])
    setActiveContactIndex(0)
    clearErrors()
  }

  const handleContactDetailChange = () => {
    markManualContactEdit()
    clearErrors()
  }

  const selectContact = (contact: ApiContactAutocomplete) => {
    setSelectedContact(contact)
    setDetachedFromOriginal(true)
    setContactName(contact.name)
    setCompany(contact.company ?? '')
    setPhone(contact.phone ?? '')
    setEmail(contact.email ?? '')
    setTelegram(contact.telegram ?? '')
    setIsMessengerOpen(Boolean(contact.telegram))
    setContactSearchEnabled(false)
    setContactSuggestions([])
    setContactSearchState('idle')
    setContactSearchError('')
    setIsContactSearchOpen(false)
    setActiveContactIndex(0)
    clearErrors()
    createdContactRef.current = null
  }

  const clearContact = () => {
    setSelectedContact(null)
    setDetachedFromOriginal(true)
    setContactName('')
    setCompany('')
    setPhone('')
    setEmail('')
    setTelegram('')
    setIsMessengerOpen(false)
    setContactSearchEnabled(true)
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

    markManualContactEdit()
    setIsMessengerOpen(true)
    setTelegram((value) => value || '@')
    clearErrors()
  }

  const removeMessenger = () => {
    if (selectedContact) {
      return
    }

    markManualContactEdit()
    setTelegram('')
    setIsMessengerOpen(false)
    clearErrors()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isLoading || isSaving || version === null || !isDirty) {
      return
    }

    const validation = validateForm({
      dealName: currentDealName,
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

    const contactPayload: CreateContactRequest = {
      name: contactName.trim(),
      company: emptyToNull(company),
      phone: validation.normalizedPhone,
      email: emptyToNull(email.toLowerCase()),
      telegram: isMessengerOpen ? validation.normalizedTelegram : null,
    }
    const dealPayload: Omit<UpdateDealRequest, 'version' | 'contact_id'> = {
      name: currentDealName.trim(),
      amount: normalizeAmount(amount),
      comment: emptyToNull(comment),
    }

    setFormErrors({})
    setRequestError('')

    if (selectedContact) {
      await performSave(dealPayload, selectedContact.id)
      return
    }

    if (!detachedFromOriginal && contactMatchesOriginal && originalContactId) {
      await performSave(dealPayload, originalContactId)
      return
    }

    const controller = new AbortController()
    saveControllerRef.current?.abort()
    saveControllerRef.current = controller
    setIsSaving(true)

    try {
      const duplicate = await findDuplicateContact(
        contactPayload.name,
        originalContactId,
        controller.signal,
      )

      if (duplicate) {
        setPendingSave({ deal: dealPayload, contact: contactPayload })
        setDuplicateContact(duplicate)
        return
      }

      const contactId = await getOrCreateContact(contactPayload, controller.signal)
      await patchDeal(dealPayload, contactId, controller.signal)
    } catch (error) {
      handleSaveError(error)
    } finally {
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null
      }
      setIsSaving(false)
    }
  }

  const performSave = async (
    dealPayload: Omit<UpdateDealRequest, 'version' | 'contact_id'>,
    contactId: string,
  ) => {
    const controller = new AbortController()
    saveControllerRef.current?.abort()
    saveControllerRef.current = controller
    setIsSaving(true)

    try {
      await patchDeal(dealPayload, contactId, controller.signal)
    } catch (error) {
      handleSaveError(error)
    } finally {
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null
      }
      setIsSaving(false)
    }
  }

  const patchDeal = async (
    dealPayload: Omit<UpdateDealRequest, 'version' | 'contact_id'>,
    contactId: string,
    signal: AbortSignal,
  ) => {
    if (version === null) {
      return
    }

    const updatedDeal = await updateDeal(
      dealId,
      {
        ...dealPayload,
        contact_id: contactId,
        version,
      },
      signal,
    )

    hydrateDeal(updatedDeal)
    showCrmToast('Сделка успешно сохранена')
  }

  const handleSaveError = (error: unknown) => {
    if (isAbortError(error)) {
      return
    }

    if (error instanceof ApiError && error.status === 409) {
      setIsConflictOpen(true)
      return
    }

    if (error instanceof ApiError && error.status === 404) {
      showCrmToast('Сделка была удалена другим пользователем')
      closeImmediately()
      return
    }

    if (error instanceof ApiError && error.status === 403) {
      showCrmToast('У вас нет прав на изменение этой сделки')
      return
    }

    setRequestError(
      error instanceof Error
        ? error.message
        : 'Не удалось сохранить изменения. Попробуйте позже.',
    )
  }

  const handleConflictRefresh = async () => {
    const controller = new AbortController()
    saveControllerRef.current?.abort()
    saveControllerRef.current = controller
    setIsSaving(true)

    try {
      const deal = await getDeal(dealId, controller.signal)
      hydrateDeal(deal)
      setIsConflictOpen(false)
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      if (error instanceof ApiError && error.status === 404) {
        showCrmToast('Сделка была удалена другим пользователем')
        closeImmediately()
        return
      }

      setRequestError(
        error instanceof Error ? error.message : 'Не удалось обновить данные сделки.',
      )
    } finally {
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null
      }
      setIsSaving(false)
    }
  }

  const resolveDuplicate = async (replaceWithExisting: boolean) => {
    const duplicate = duplicateContact
    const pending = pendingSave
    if (!duplicate || !pending || isSaving) {
      return
    }

    if (replaceWithExisting) {
      setSelectedContact(duplicate)
      setDetachedFromOriginal(true)
      setContactName(duplicate.name)
      setCompany(duplicate.company ?? '')
      setPhone(duplicate.phone ?? '')
      setEmail(duplicate.email ?? '')
      setTelegram(duplicate.telegram ?? '')
      setIsMessengerOpen(Boolean(duplicate.telegram))
    }

    setDuplicateContact(null)
    setPendingSave(null)

    const controller = new AbortController()
    saveControllerRef.current?.abort()
    saveControllerRef.current = controller
    setIsSaving(true)

    try {
      const contactId = replaceWithExisting
        ? duplicate.id
        : await getOrCreateContact(pending.contact, controller.signal)
      await patchDeal(pending.deal, contactId, controller.signal)
    } catch (error) {
      handleSaveError(error)
    } finally {
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null
      }
      setIsSaving(false)
    }
  }

  const getOrCreateContact = async (
    payload: CreateContactRequest,
    signal: AbortSignal,
  ) => {
    const signature = JSON.stringify(payload)
    if (createdContactRef.current?.signature === signature) {
      return createdContactRef.current.id
    }

    const contact = await createContact(payload, signal)
    createdContactRef.current = { signature, id: contact.id }
    return contact.id
  }

  const isContactDetailsLocked = isLoading || isSaving || Boolean(selectedContact)
  const hasLinkedContact = Boolean(originalContactId || selectedContact)
  const isBusy = isLoading || isSaving

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
          aria-labelledby="edit-deal-v2-title"
          aria-busy={isBusy}
          tabIndex={-1}
          onKeyDown={handleModalKeyDown}
        >
          <header className="create-deal-modal__header">
            <h2 id="edit-deal-v2-title">Просмотр сделки</h2>
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

          {isLoading ? (
            <div className="create-deal-v2__loading" role="status">
              Загружаем данные сделки…
            </div>
          ) : loadError ? (
            <div className="create-deal-v2__loading" role="alert">
              <p>{loadError}</p>
              <button type="button" onClick={() => void loadDeal(new AbortController())}>
                Повторить
              </button>
            </div>
          ) : (
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
                    value={currentDealName}
                    placeholder="Введите название"
                    disabled={isSaving}
                    aria-invalid={Boolean(formErrors.dealName)}
                    onChange={(event) => {
                      setCurrentDealName(event.target.value)
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
                    <label htmlFor="edit-deal-v2-contact-name">ФИО</label>
                    <div className="create-deal-form__contact-search">
                      <input
                        ref={contactInputRef}
                        id="edit-deal-v2-contact-name"
                        className={`create-deal-form__plain-input${
                          selectedContact
                            ? ' create-deal-form__plain-input--selected'
                            : ''
                        }`}
                        type="text"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={isContactSearchOpen}
                        aria-controls="edit-deal-v2-contact-options"
                        aria-activedescendant={
                          isContactSearchOpen && contactSuggestions[activeContactIndex]
                            ? `edit-deal-v2-contact-${contactSuggestions[activeContactIndex].id}`
                            : undefined
                        }
                        aria-invalid={Boolean(formErrors.contactName)}
                        value={contactName}
                        placeholder="Введите ФИО"
                        disabled={isSaving}
                        onChange={(event) => handleContactNameChange(event.target.value)}
                        onKeyDown={handleContactKeyDown}
                        onFocus={() => {
                          if (
                            contactSearchEnabled
                            && (contactSuggestions.length > 0 || contactSearchState === 'error')
                          ) {
                            setIsContactSearchOpen(true)
                          }
                        }}
                        onBlur={() => {
                          window.setTimeout(() => setIsContactSearchOpen(false), 120)
                        }}
                      />

                      {(hasLinkedContact || detachedFromOriginal) && (
                        <button
                          className="create-deal-form__contact-clear"
                          type="button"
                          aria-label="Отвязать контакт"
                          title="Отвязать контакт"
                          disabled={isSaving}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={clearContact}
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
                          id="edit-deal-v2-contact-options"
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
                                id={`edit-deal-v2-contact-${contact.id}`}
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
                      placeholder="Введите название"
                      disabled={isContactDetailsLocked}
                      onChange={(event) => {
                        setCompany(event.target.value)
                        handleContactDetailChange()
                      }}
                    />
                  </FieldRow>

                  <FieldRow label="Телефон:">
                    <input
                      className="create-deal-form__plain-input"
                      type="tel"
                      value={phone}
                      placeholder="Введите номер"
                      disabled={isContactDetailsLocked}
                      aria-invalid={Boolean(formErrors.phone)}
                      onChange={(event) => {
                        setPhone(event.target.value)
                        handleContactDetailChange()
                      }}
                    />
                    <FieldError>{formErrors.phone}</FieldError>
                  </FieldRow>

                  <FieldRow label="e-mail:">
                    <input
                      className="create-deal-form__plain-input"
                      type="email"
                      value={email}
                      placeholder="Введите e-mail"
                      disabled={isContactDetailsLocked}
                      aria-invalid={Boolean(formErrors.email)}
                      onChange={(event) => {
                        setEmail(event.target.value)
                        handleContactDetailChange()
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
                          placeholder="@username"
                          disabled={isContactDetailsLocked}
                          aria-invalid={Boolean(formErrors.telegram)}
                          onChange={(event) => {
                            setTelegram(event.target.value)
                            handleContactDetailChange()
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
                disabled={isSaving || !isDirty}
              >
                {isSaving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </form>
          )}
        </div>
      </div>

      {isCloseConfirmOpen && (
        <ConfirmDialog
          title="Закрыть окно?"
          text="Вы действительно хотите закрыть окно? Все несохранённые изменения будут потеряны."
          primaryLabel="Остаться"
          secondaryLabel="Закрыть"
          secondaryDanger
          onPrimary={() => setIsCloseConfirmOpen(false)}
          onSecondary={closeImmediately}
        />
      )}

      {isConflictOpen && (
        <ConfirmDialog
          title="Конфликт изменений"
          text="Сделка была изменена другим пользователем. Ваши изменения не сохранены. Обновить данные?"
          primaryLabel="Обновить"
          secondaryLabel="Отмена"
          onPrimary={() => void handleConflictRefresh()}
          onSecondary={() => setIsConflictOpen(false)}
        />
      )}

      {duplicateContact && (
        <ConfirmDialog
          title="Обнаружен существующий контакт"
          text={`Найден контакт с именем "${duplicateContact.name}". Заменить данные контакта на данные этого контакта?`}
          primaryLabel="Заменить"
          secondaryLabel="Оставить новые данные"
          onPrimary={() => void resolveDuplicate(true)}
          onSecondary={() => void resolveDuplicate(false)}
        />
      )}
    </>,
    document.body,
  )
}

function ConfirmDialog({
  title,
  text,
  primaryLabel,
  secondaryLabel,
  secondaryDanger = false,
  onPrimary,
  onSecondary,
}: {
  title: string
  text: string
  primaryLabel: string
  secondaryLabel: string
  secondaryDanger?: boolean
  onPrimary: () => void
  onSecondary: () => void
}) {
  return (
    <div className="create-deal-v2__confirm-overlay" role="presentation">
      <div
        className="create-deal-v2__confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3>{title}</h3>
        <p>{text}</p>
        <div>
          <button type="button" onClick={onPrimary}>
            {primaryLabel}
          </button>
          <button
            type="button"
            className={secondaryDanger ? 'is-danger' : undefined}
            onClick={onSecondary}
          >
            {secondaryLabel}
          </button>
        </div>
      </div>
    </div>
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

async function findDuplicateContact(
  name: string,
  currentContactId: string | null,
  signal: AbortSignal,
) {
  const normalizedName = normalizeName(name)
  const exact = await findContactByName(name, signal)

  if (
    exact
    && exact.id !== currentContactId
    && normalizeName(exact.name) === normalizedName
  ) {
    return exact
  }

  if (signal.aborted) {
    return null
  }

  const candidates = await searchContacts(name, 10, signal)
  return candidates.find(
    (contact) =>
      contact.id !== currentContactId
      && normalizeName(contact.name) === normalizedName,
  ) ?? null
}

function normalizeContactSnapshot(values: ContactSnapshot): ContactSnapshot {
  return {
    name: values.name.trim(),
    company: values.company.trim(),
    phone: normalizePhoneForCompare(values.phone),
    email: values.email.trim().toLowerCase(),
    telegram: normalizeTelegramForCompare(values.telegram),
  }
}

function normalizePhoneForCompare(value: string) {
  if (!value.trim()) {
    return ''
  }

  try {
    return normalizePhone(value)
  } catch {
    return value.trim().replace(/[\s\-()]/g, '')
  }
}

function normalizeTelegramForCompare(value: string) {
  const username = value.replace(/@/g, '').trim()
  return username ? `@${username}` : ''
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

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU')
}

function snapshotsEqual(first: unknown, second: unknown) {
  return JSON.stringify(first) === JSON.stringify(second)
}

function getContactSummary(contact: ApiContactAutocomplete) {
  const details = [contact.company, contact.phone, contact.email]
    .filter((value): value is string => Boolean(value))
  return details.join(' · ') || 'Контакт без дополнительных данных'
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

const emptyContactSnapshot: ContactSnapshot = {
  name: '',
  company: '',
  phone: '',
  email: '',
  telegram: '',
}
