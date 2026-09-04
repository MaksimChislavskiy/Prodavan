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
} from '../../shared/api/dealsApi'
import { CRM_REALTIME_EVENT } from '../../shared/crmRealtime'
import { showCrmToast } from '../../shared/crmToast'
import './CreateDealModal.css'
import './CreateDealModalV2.css'
import './DealDetailModal.css'

export type DealModalMode = 'view' | 'edit'

export type RealtimeDealModalProps = {
  dealId: string
  dealName: string
  onClose: () => void
  initialMode?: DealModalMode
}

type DealDraft = {
  name: string
  amount: string
  comment: string
  contactName: string
  company: string
  phone: string
  email: string
  telegram: string
  messengerOpen: boolean
  linkedContact: ApiContactAutocomplete | null
}

type FormErrors = Partial<
  Record<'name' | 'amount' | 'contactName' | 'phone' | 'email' | 'telegram', string>
>

type RealtimePayload = {
  event?: unknown
  deal_id?: unknown
  data?: { deal_id?: unknown }
}

const CONTACT_SEARCH_DELAY = 300
const MAX_AMOUNT = 9_999_999_999_999.99
const CONTACT_NAME_PATTERN = /^[A-Za-zА-Яа-яЁё\- ]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TELEGRAM_PATTERN = /^[A-Za-z0-9_]{5,32}$/

export function RealtimeDealModal(props: RealtimeDealModalProps) {
  const { dealId, onClose, initialMode = 'view' } = props
  const modalRef = useRef<HTMLDivElement | null>(null)
  const firstInputRef = useRef<HTMLInputElement | null>(null)
  const loadControllerRef = useRef<AbortController | null>(null)
  const searchControllerRef = useRef<AbortController | null>(null)
  const saveControllerRef = useRef<AbortController | null>(null)
  const isSavingRef = useRef(false)
  const externalWarningShownRef = useRef(false)
  const deletedRef = useRef(false)
  const suppressOwnUpdateUntilRef = useRef(0)
  const createdContactRef = useRef<{ signature: string; id: string } | null>(null)

  const [mode, setMode] = useState<DealModalMode>(initialMode)
  const [deal, setDeal] = useState<ApiDealDetail | null>(null)
  const [draft, setDraft] = useState<DealDraft | null>(null)
  const [baseline, setBaseline] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [isConflictOpen, setIsConflictOpen] = useState(false)
  const [duplicateContact, setDuplicateContact] =
    useState<ApiContactAutocomplete | null>(null)
  const [contactSuggestions, setContactSuggestions] =
    useState<ApiContactAutocomplete[]>([])
  const [activeContactIndex, setActiveContactIndex] = useState(0)
  const [isContactSearchOpen, setIsContactSearchOpen] = useState(false)

  const dirty = useMemo(() => {
    if (mode !== 'edit' || !draft || !baseline) return false
    return serializeDraft(draft) !== baseline
  }, [baseline, draft, mode])

  const loadDeal = async (targetMode = mode) => {
    loadControllerRef.current?.abort()
    const controller = new AbortController()
    loadControllerRef.current = controller
    setIsLoading(true)
    setLoadError('')

    try {
      const loaded = await getDeal(dealId, controller.signal)
      if (controller.signal.aborted) return
      setDeal(loaded)
      if (targetMode === 'edit') hydrateEdit(loaded)
      setIsLoading(false)
    } catch (error) {
      if (isAbortError(error)) return
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
        error instanceof Error ? error.message : 'Не удалось загрузить данные сделки.',
      )
      setIsLoading(false)
    }
  }

  const hydrateEdit = (source: ApiDealDetail) => {
    const nextDraft = draftFromDeal(source)
    setDraft(nextDraft)
    setBaseline(serializeDraft(nextDraft))
    setFormErrors({})
    setRequestError('')
    setContactSuggestions([])
    setIsContactSearchOpen(false)
    externalWarningShownRef.current = false
    createdContactRef.current = null
    window.setTimeout(() => firstInputRef.current?.focus(), 0)
  }

  useEffect(() => {
    void loadDeal(initialMode)

    return () => {
      loadControllerRef.current?.abort()
      searchControllerRef.current?.abort()
      saveControllerRef.current?.abort()
    }
    // initialMode is intentionally captured only for the initial opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  useEffect(() => {
    if (mode !== 'edit' || !draft || draft.linkedContact) {
      searchControllerRef.current?.abort()
      setContactSuggestions([])
      setIsContactSearchOpen(false)
      return
    }

    const query = draft.contactName.trim()
    if (query.length < 2) {
      searchControllerRef.current?.abort()
      setContactSuggestions([])
      setIsContactSearchOpen(false)
      return
    }

    searchControllerRef.current?.abort()
    const controller = new AbortController()
    searchControllerRef.current = controller
    const timeoutId = window.setTimeout(() => {
      void searchContacts(query, 5, controller.signal)
        .then((items) => {
          if (controller.signal.aborted) return
          setContactSuggestions(items)
          setActiveContactIndex(0)
          setIsContactSearchOpen(items.length > 0)
        })
        .catch((error) => {
          if (!isAbortError(error)) setContactSuggestions([])
        })
    }, CONTACT_SEARCH_DELAY)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [draft?.contactName, draft?.linkedContact, mode])

  useEffect(() => {
    deletedRef.current = false

    const handleRealtime = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const payload = event.detail as RealtimePayload | null
      if (getRealtimeDealId(payload) !== dealId) return
      const eventName = typeof payload?.event === 'string' ? payload.event : ''

      if (eventName === 'deal_deleted') {
        if (deletedRef.current) return
        deletedRef.current = true
        loadControllerRef.current?.abort()
        searchControllerRef.current?.abort()
        saveControllerRef.current?.abort()
        showCrmToast('Сделка была удалена другим пользователем')
        onClose()
        return
      }

      if (eventName !== 'deal_updated') return
      if (isSavingRef.current || Date.now() < suppressOwnUpdateUntilRef.current) return

      if (mode === 'view') {
        void loadDeal('view')
        return
      }

      if (!externalWarningShownRef.current) {
        externalWarningShownRef.current = true
        showCrmToast('Сделка была изменена другим пользователем. Обновите данные.')
      }
    }

    window.addEventListener(CRM_REALTIME_EVENT, handleRealtime)
    return () => window.removeEventListener(CRM_REALTIME_EVENT, handleRealtime)
    // loadDeal is intentionally not a dependency: realtime always uses current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, mode, onClose])

  const enterEdit = () => {
    if (!deal || isLoading) return
    setMode('edit')
    hydrateEdit(deal)
  }

  const clearErrors = () => {
    setFormErrors({})
    setRequestError('')
  }

  const setDraftValue = <K extends keyof DealDraft>(key: K, value: DealDraft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
    clearErrors()
  }

  const unlinkContact = (nextName = '') => {
    setDraft((current) => current ? {
      ...current,
      contactName: nextName,
      company: '',
      phone: '',
      email: '',
      telegram: '',
      messengerOpen: false,
      linkedContact: null,
    } : current)
    setContactSuggestions([])
    setIsContactSearchOpen(false)
    createdContactRef.current = null
    clearErrors()
  }

  const handleContactNameChange = (value: string) => {
    if (!draft) return
    if (draft.linkedContact) {
      unlinkContact(value)
      return
    }
    setDraftValue('contactName', value)
    createdContactRef.current = null
  }

  const selectContact = (contact: ApiContactAutocomplete) => {
    setDraft((current) => current ? {
      ...current,
      contactName: contact.name,
      company: contact.company ?? '',
      phone: contact.phone ?? '',
      email: contact.email ?? '',
      telegram: contact.telegram ?? '',
      messengerOpen: Boolean(contact.telegram),
      linkedContact: contact,
    } : current)
    setContactSuggestions([])
    setIsContactSearchOpen(false)
    setActiveContactIndex(0)
    createdContactRef.current = null
    clearErrors()
  }

  const handleContactKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isContactSearchOpen || contactSuggestions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveContactIndex((index) => Math.min(index + 1, contactSuggestions.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveContactIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      const contact = contactSuggestions[activeContactIndex]
      if (contact) {
        event.preventDefault()
        selectContact(contact)
      }
    }
  }

  const handleAmountChange = (value: string) => {
    const normalized = value.replace(',', '.')
    if (normalized === '' || /^\d{0,13}(?:\.\d{0,2})?$/.test(normalized)) {
      setDraftValue('amount', normalized)
    }
  }

  const validateDraft = (source: DealDraft) => {
    const errors: FormErrors = {}
    const name = source.name.trim()
    const contactName = source.contactName.trim()
    const amount = normalizeAmount(source.amount)

    if (!name) errors.name = 'Обязательное поле'
    else if (name.length > 255) errors.name = 'Название сделки должно содержать не больше 255 символов'

    if (amount !== null) {
      const value = Number(amount)
      if (!Number.isFinite(value) || value < 0) {
        errors.amount = 'Сумма должна быть положительным числом (разделитель – точка)'
      } else if (value > MAX_AMOUNT) {
        errors.amount = 'Сумма не может превышать 9999999999999.99'
      }
    }

    if (!contactName) errors.contactName = 'ФИО обязательно'
    else if (contactName.length > 100 || !CONTACT_NAME_PATTERN.test(contactName)) {
      errors.contactName = 'ФИО: 1–100 символов, только буквы, пробелы и дефисы'
    }

    let normalizedPhone: string | null = null
    if (source.phone.trim()) {
      try {
        normalizedPhone = normalizePhone(source.phone)
      } catch {
        errors.phone = 'Некорректный номер телефона'
      }
    }

    const normalizedEmail = source.email.trim().toLowerCase()
    if (normalizedEmail && !EMAIL_PATTERN.test(normalizedEmail)) {
      errors.email = 'Введите корректный email'
    }

    let normalizedTelegram: string | null = null
    if (source.messengerOpen && source.telegram.trim()) {
      const username = source.telegram.replace(/^@+/, '').trim()
      if (!TELEGRAM_PATTERN.test(username)) {
        errors.telegram =
          'Никнейм Telegram: 5–32 символа (латиница, цифры, _). Символ @ добавится автоматически'
      } else {
        normalizedTelegram = `@${username}`
      }
    }

    return {
      errors,
      deal: {
        name,
        amount,
        comment: emptyToNull(source.comment),
      },
      contact: {
        name: contactName,
        company: emptyToNull(source.company),
        phone: normalizedPhone,
        email: normalizedEmail || null,
        telegram: source.messengerOpen ? normalizedTelegram : null,
      } satisfies CreateContactRequest,
    }
  }

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!draft || isSaving || !dirty) return
    const validation = validateDraft(draft)
    setFormErrors(validation.errors)
    setRequestError('')
    if (Object.keys(validation.errors).length > 0) return

    if (draft.linkedContact) {
      await saveWithContact(draft.linkedContact.id, validation.deal)
      return
    }

    const duplicateController = new AbortController()
    saveControllerRef.current?.abort()
    saveControllerRef.current = duplicateController
    setIsSaving(true)
    isSavingRef.current = true

    try {
      const duplicate = await findContactByName(
        validation.contact.name,
        duplicateController.signal,
      )
      if (duplicateController.signal.aborted) return
      if (duplicate) {
        setDuplicateContact(duplicate)
        return
      }
      await createContactAndSave(validation.contact, validation.deal, duplicateController)
    } catch (error) {
      handleSaveError(error)
    } finally {
      if (saveControllerRef.current === duplicateController) {
        saveControllerRef.current = null
      }
      setIsSaving(false)
      isSavingRef.current = false
    }
  }

  const createContactAndSave = async (
    contactPayload: CreateContactRequest,
    dealPayload: { name: string; amount: string | null; comment: string | null },
    controller?: AbortController,
  ) => {
    const activeController = controller ?? new AbortController()
    if (!controller) {
      saveControllerRef.current?.abort()
      saveControllerRef.current = activeController
      setIsSaving(true)
      isSavingRef.current = true
    }

    try {
      const signature = JSON.stringify(contactPayload)
      let contactId = createdContactRef.current?.signature === signature
        ? createdContactRef.current.id
        : null

      if (!contactId) {
        const created = await createContact(contactPayload, activeController.signal)
        contactId = created.id
        createdContactRef.current = { signature, id: created.id }
      }
      await patchDeal(contactId, dealPayload, activeController)
    } catch (error) {
      handleSaveError(error, true)
    } finally {
      if (!controller) {
        if (saveControllerRef.current === activeController) saveControllerRef.current = null
        setIsSaving(false)
        isSavingRef.current = false
      }
    }
  }

  const saveWithContact = async (
    contactId: string,
    dealPayload: { name: string; amount: string | null; comment: string | null },
  ) => {
    const controller = new AbortController()
    saveControllerRef.current?.abort()
    saveControllerRef.current = controller
    setIsSaving(true)
    isSavingRef.current = true
    try {
      await patchDeal(contactId, dealPayload, controller)
    } catch (error) {
      handleSaveError(error)
    } finally {
      if (saveControllerRef.current === controller) saveControllerRef.current = null
      setIsSaving(false)
      isSavingRef.current = false
    }
  }

  const patchDeal = async (
    contactId: string,
    dealPayload: { name: string; amount: string | null; comment: string | null },
    controller: AbortController,
  ) => {
    if (!deal) return
    const updated = await updateDeal(
      deal.id,
      {
        version: deal.version,
        name: dealPayload.name,
        amount: dealPayload.amount,
        comment: dealPayload.comment,
        contact_id: contactId,
      },
      controller.signal,
    )
    if (controller.signal.aborted) return

    suppressOwnUpdateUntilRef.current = Date.now() + 1_500
    setDeal(updated)
    setMode('view')
    setDraft(null)
    setBaseline('')
    setRequestError('')
    setFormErrors({})
    externalWarningShownRef.current = false
    showCrmToast('Сделка успешно обновлена')
  }

  const handleSaveError = (error: unknown, contactStage = false) => {
    if (isAbortError(error)) return

    if (error instanceof ApiError && error.status === 409) {
      setIsConflictOpen(true)
      return
    }
    if (error instanceof ApiError && error.status === 404) {
      showCrmToast('Сделка была удалена другим пользователем')
      onClose()
      return
    }
    if (error instanceof ApiError && error.status === 403) {
      showCrmToast('У вас нет прав на изменение этой сделки')
      return
    }
    if (contactStage && error instanceof ApiError && error.status === 400) {
      setRequestError('Не удалось сохранить контакт. Проверьте данные')
      return
    }
    if (error instanceof Error && error.message === 'Проверьте подключение к интернету') {
      setRequestError(error.message)
      return
    }
    setRequestError('Не удалось сохранить сделку. Попробуйте позже')
  }

  const refreshConflict = async () => {
    setIsConflictOpen(false)
    await loadDeal('edit')
    setMode('edit')
  }

  const requestClose = () => {
    if (isLoading || isSaving) return
    if (mode === 'edit' && dirty) {
      setIsCloseConfirmOpen(true)
      return
    }
    onClose()
  }

  const closeImmediately = () => {
    loadControllerRef.current?.abort()
    searchControllerRef.current?.abort()
    saveControllerRef.current?.abort()
    onClose()
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) requestClose()
  }

  const handleModalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !isLoading && !isSaving) {
      event.preventDefault()
      requestClose()
      return
    }
    if (event.key !== 'Tab' || !modalRef.current) return

    const focusable = Array.from(
      modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
      ),
    )
    if (focusable.length === 0) return
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

  const goToChat = () => {
    const contactId = mode === 'view'
      ? deal?.contact?.id
      : draft?.linkedContact?.id
    if (!contactId) return
    window.location.assign(`/app/chats?contact_id=${encodeURIComponent(contactId)}`)
  }

  const modal = (
    <>
      <div
        className="create-deal-overlay"
        role="presentation"
        onMouseDown={handleOverlayMouseDown}
      >
        <div
          ref={modalRef}
          className="create-deal-modal deal-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deal-detail-title"
          aria-busy={isLoading || isSaving}
          tabIndex={-1}
          onKeyDown={handleModalKeyDown}
        >
          <header className="create-deal-modal__header">
            <h2 id="deal-detail-title">
              {mode === 'view' ? 'Просмотр сделки' : 'Редактировать сделку'}
            </h2>
            <div className="deal-detail-modal__header-actions">
              {mode === 'view' && deal && !isLoading && (
                <button
                  className="deal-detail-modal__edit"
                  type="button"
                  aria-label="Редактировать сделку"
                  title="Редактировать"
                  onClick={enterEdit}
                >
                  ✎
                </button>
              )}
              <button
                className="deal-detail-modal__close"
                type="button"
                aria-label="Закрыть"
                disabled={isSaving}
                onClick={requestClose}
              >
                ×
              </button>
            </div>
          </header>

          {isLoading ? (
            <div className="deal-detail-modal__status" role="status">
              Загружаем данные сделки…
            </div>
          ) : loadError ? (
            <div className="deal-detail-modal__status" role="alert">
              <p>{loadError}</p>
              <button type="button" onClick={() => void loadDeal(mode)}>
                Повторить
              </button>
            </div>
          ) : deal && mode === 'view' ? (
            <ViewMode deal={deal} onChat={goToChat} />
          ) : deal && draft ? (
            <form
              className="deal-detail-modal__body"
              noValidate
              onSubmit={(event) => void handleSubmit(event)}
            >
              <div className="deal-detail-modal__content">
                <FieldRow label="Название сделки">
                  <FieldBox error={formErrors.name}>
                    <input
                      ref={firstInputRef}
                      className="deal-detail-modal__input"
                      value={draft.name}
                      maxLength={255}
                      placeholder="Введите название"
                      disabled={isSaving}
                      aria-invalid={Boolean(formErrors.name)}
                      onChange={(event) => setDraftValue('name', event.target.value)}
                    />
                  </FieldBox>
                </FieldRow>

                <FieldRow label="Сделка на сумму">
                  <FieldBox error={formErrors.amount}>
                    <input
                      className="deal-detail-modal__input"
                      type="text"
                      inputMode="decimal"
                      value={draft.amount}
                      placeholder="0"
                      disabled={isSaving}
                      aria-invalid={Boolean(formErrors.amount)}
                      onChange={(event) => handleAmountChange(event.target.value)}
                    />
                  </FieldBox>
                </FieldRow>

                <FieldRow label="ФИО">
                  <FieldBox error={formErrors.contactName} className="deal-detail-modal__contact-field">
                    <input
                      className="deal-detail-modal__input"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={isContactSearchOpen}
                      value={draft.contactName}
                      maxLength={100}
                      placeholder="Введите ФИО"
                      disabled={isSaving}
                      aria-invalid={Boolean(formErrors.contactName)}
                      onChange={(event) => handleContactNameChange(event.target.value)}
                      onKeyDown={handleContactKeyDown}
                      onFocus={() => {
                        if (contactSuggestions.length > 0) setIsContactSearchOpen(true)
                      }}
                      onBlur={() => window.setTimeout(() => setIsContactSearchOpen(false), 120)}
                    />
                    {draft.linkedContact && (
                      <button
                        className="deal-detail-modal__contact-clear"
                        type="button"
                        aria-label="Отвязать контакт"
                        disabled={isSaving}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => unlinkContact()}
                      >
                        ×
                      </button>
                    )}
                    {isContactSearchOpen && contactSuggestions.length > 0 && (
                      <div className="deal-detail-modal__options" role="listbox">
                        {contactSuggestions.map((contact, index) => (
                          <button
                            className={`deal-detail-modal__option${index === activeContactIndex ? ' is-active' : ''}`}
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
                        ))}
                      </div>
                    )}
                  </FieldBox>
                </FieldRow>

                {draft.linkedContact ? (
                  <>
                    <LockedRow label="Компания" value={draft.company} />
                    <LockedRow label="Телефон" value={draft.phone} />
                    <LockedRow label="e-mail" value={draft.email} />
                    {draft.telegram && (
                      <div className="deal-detail-modal__row">
                        <span>Telegram</span>
                        <span className="deal-detail-modal__locked deal-detail-modal__telegram-card">
                          {draft.telegram}
                        </span>
                      </div>
                    )}
                    <button
                      className="deal-detail-modal__messenger"
                      type="button"
                      disabled
                    >
                      Добавить мессенджер
                    </button>
                  </>
                ) : (
                  <>
                    <FieldRow label="Компания">
                      <input
                        className="deal-detail-modal__input"
                        value={draft.company}
                        maxLength={100}
                        placeholder="Введите название"
                        disabled={isSaving}
                        onChange={(event) => setDraftValue('company', event.target.value)}
                      />
                    </FieldRow>
                    <FieldRow label="Телефон">
                      <FieldBox error={formErrors.phone}>
                        <input
                          className="deal-detail-modal__input"
                          type="tel"
                          value={draft.phone}
                          maxLength={64}
                          placeholder="Введите номер"
                          disabled={isSaving}
                          aria-invalid={Boolean(formErrors.phone)}
                          onChange={(event) => setDraftValue('phone', event.target.value)}
                        />
                      </FieldBox>
                    </FieldRow>
                    <FieldRow label="e-mail">
                      <FieldBox error={formErrors.email}>
                        <input
                          className="deal-detail-modal__input"
                          type="email"
                          value={draft.email}
                          maxLength={255}
                          placeholder="Введите e-mail"
                          disabled={isSaving}
                          aria-invalid={Boolean(formErrors.email)}
                          onChange={(event) => setDraftValue('email', event.target.value)}
                        />
                      </FieldBox>
                    </FieldRow>

                    {!draft.messengerOpen ? (
                      <button
                        className="deal-detail-modal__messenger"
                        type="button"
                        disabled={isSaving}
                        onClick={() => {
                          setDraftValue('messengerOpen', true)
                          setDraftValue('telegram', '@')
                        }}
                      >
                        Добавить мессенджер
                      </button>
                    ) : (
                      <FieldRow label="Telegram">
                        <FieldBox error={formErrors.telegram}>
                          <div className="deal-detail-modal__telegram-edit">
                            <input
                              className="deal-detail-modal__input"
                              value={draft.telegram}
                              maxLength={64}
                              placeholder="@username"
                              disabled={isSaving}
                              aria-invalid={Boolean(formErrors.telegram)}
                              onChange={(event) => setDraftValue('telegram', event.target.value)}
                            />
                            <button
                              className="deal-detail-modal__telegram-remove"
                              type="button"
                              aria-label="Удалить Telegram"
                              disabled={isSaving}
                              onClick={() => setDraft((current) => current ? {
                                ...current,
                                telegram: '',
                                messengerOpen: false,
                              } : current)}
                            >
                              ×
                            </button>
                          </div>
                        </FieldBox>
                      </FieldRow>
                    )}
                  </>
                )}

                <div className="deal-detail-modal__divider" />

                <FieldRow label="Комментарий">
                  <textarea
                    className="deal-detail-modal__textarea"
                    value={draft.comment}
                    maxLength={500}
                    placeholder="Написать..."
                    disabled={isSaving}
                    onChange={(event) => setDraftValue('comment', event.target.value)}
                  />
                </FieldRow>

                {requestError && (
                  <p className="deal-detail-modal__error" role="alert">
                    {requestError}
                  </p>
                )}

                <div className="deal-detail-modal__footer">
                  <button
                    className="deal-detail-modal__save"
                    type="submit"
                    disabled={!dirty || isSaving}
                  >
                    {isSaving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  <button
                    className="deal-detail-modal__chat"
                    type="button"
                    disabled={!draft.linkedContact || isSaving}
                    onClick={goToChat}
                  >
                    Перейти в чат
                  </button>
                </div>
              </div>
            </form>
          ) : null}
        </div>
      </div>

      {isCloseConfirmOpen && (
        <ConfirmDialog
          title="Закрыть окно?"
          text="Вы действительно хотите закрыть окно? Все несохранённые изменения будут потеряны."
          primary="Закрыть"
          secondary="Остаться"
          onPrimary={closeImmediately}
          onSecondary={() => setIsCloseConfirmOpen(false)}
        />
      )}

      {isConflictOpen && (
        <ConfirmDialog
          title="Конфликт изменений"
          text="Сделка была изменена другим пользователем. Ваши изменения не сохранены. Обновить данные?"
          primary="Обновить"
          secondary="Отмена"
          onPrimary={() => void refreshConflict()}
          onSecondary={() => setIsConflictOpen(false)}
        />
      )}

      {duplicateContact && draft && (
        <ConfirmDialog
          title="Обнаружен существующий контакт"
          text={`Найден контакт с именем "${duplicateContact.name}". Заменить данные контакта на данные этого контакта?`}
          primary="Заменить"
          secondary="Оставить новые данные"
          onPrimary={() => {
            const selected = duplicateContact
            setDuplicateContact(null)
            selectContact(selected)
          }}
          onSecondary={() => {
            const validation = validateDraft(draft)
            setDuplicateContact(null)
            if (Object.keys(validation.errors).length > 0) {
              setFormErrors(validation.errors)
              return
            }
            void createContactAndSave(validation.contact, validation.deal)
          }}
        />
      )}
    </>
  )

  return createPortal(modal, document.body)
}

function ViewMode({ deal, onChat }: { deal: ApiDealDetail; onChat: () => void }) {
  return (
    <div className="deal-detail-modal__body">
      <div className="deal-detail-modal__content">
        <ReadRow label="Название сделки" value={deal.name} />
        <ReadRow label="Сделка на сумму" value={formatAmount(deal.amount, deal.currency)} />
        <ReadRow label="ФИО" value={deal.contact?.name ?? ''} />
        <ReadRow label="Компания" value={deal.contact?.company ?? ''} />
        <ReadRow label="Телефон" value={deal.contact?.phone ?? ''} />
        <ReadRow label="e-mail" value={deal.contact?.email ?? ''} />
        {deal.contact?.telegram && (
          <ReadRow label="Telegram" value={deal.contact.telegram} />
        )}
        <div className="deal-detail-modal__divider" />
        <ReadRow label="Комментарий" value={deal.comment ?? ''} preserveEmpty />
        <div className="deal-detail-modal__view-footer">
          <button
            className="deal-detail-modal__chat"
            type="button"
            disabled={!deal.contact}
            onClick={onChat}
          >
            Перейти в чат
          </button>
        </div>
      </div>
    </div>
  )
}

function ReadRow({
  label,
  value,
  preserveEmpty = false,
}: {
  label: string
  value: string
  preserveEmpty?: boolean
}) {
  return (
    <div className="deal-detail-modal__row">
      <span>{label}</span>
      <span className={`deal-detail-modal__value${preserveEmpty && !value ? ' deal-detail-modal__value--empty' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="deal-detail-modal__row">
      <label>{label}</label>
      {children}
    </div>
  )
}

function LockedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="deal-detail-modal__row">
      <span>{label}</span>
      <span className="deal-detail-modal__locked">{value}</span>
    </div>
  )
}

function FieldBox({
  children,
  error,
  className = '',
}: {
  children: ReactNode
  error?: string
  className?: string
}) {
  return (
    <div className={`deal-detail-modal__field ${className}`.trim()}>
      {children}
      {error && <em className="deal-detail-modal__field-error">{error}</em>}
    </div>
  )
}

function ConfirmDialog(props: {
  title: string
  text: string
  primary: string
  secondary: string
  onPrimary: () => void
  onSecondary: () => void
}) {
  return (
    <div className="deal-detail-modal__confirm-overlay" role="presentation">
      <div className="deal-detail-modal__confirm" role="alertdialog" aria-modal="true">
        <h3>{props.title}</h3>
        <p>{props.text}</p>
        <div className="deal-detail-modal__confirm-actions">
          <button type="button" onClick={props.onSecondary}>
            {props.secondary}
          </button>
          <button className="is-primary" type="button" onClick={props.onPrimary}>
            {props.primary}
          </button>
        </div>
      </div>
    </div>
  )
}

function draftFromDeal(deal: ApiDealDetail): DealDraft {
  const contact = deal.contact
  return {
    name: deal.name,
    amount: deal.amount ?? '',
    comment: deal.comment ?? '',
    contactName: contact?.name ?? '',
    company: contact?.company ?? '',
    phone: contact?.phone ?? '',
    email: contact?.email ?? '',
    telegram: contact?.telegram ?? '',
    messengerOpen: Boolean(contact?.telegram),
    linkedContact: contact ? {
      id: contact.id,
      name: contact.name,
      company: contact.company,
      phone: contact.phone,
      email: contact.email,
      telegram: contact.telegram,
    } : null,
  }
}

function serializeDraft(draft: DealDraft) {
  return JSON.stringify({
    name: draft.name.trim(),
    amount: normalizeAmount(draft.amount),
    comment: emptyToNull(draft.comment),
    contactId: draft.linkedContact?.id ?? null,
    contactName: draft.contactName.trim(),
    company: draft.company.trim(),
    phone: normalizePhoneForCompare(draft.phone),
    email: draft.email.trim().toLowerCase(),
    telegram: draft.messengerOpen ? normalizeTelegramForCompare(draft.telegram) : '',
    messengerOpen: draft.messengerOpen,
  })
}

function normalizeAmount(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  const [integerPart, fractionPart = ''] = normalized.split('.')
  return fractionPart
    ? `${integerPart}.${fractionPart.padEnd(2, '0')}`
    : `${integerPart}.00`
}

function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s\-()]/g, '')
  if (!/^\+?\d+$/.test(compact) || compact.slice(1).includes('+')) {
    throw new Error('invalid phone')
  }
  let normalized = compact
  if (/^8\d{10}$/.test(normalized)) normalized = `+7${normalized.slice(1)}`
  else if (/^\d{10}$/.test(normalized)) normalized = `+7${normalized}`
  const digits = normalized.replace(/^\+/, '')
  if (digits.length < 7 || digits.length > 15) throw new Error('invalid phone')
  return normalized
}

function normalizePhoneForCompare(value: string) {
  if (!value.trim()) return ''
  try {
    return normalizePhone(value)
  } catch {
    return value.trim().replace(/[\s\-()]/g, '')
  }
}

function normalizeTelegramForCompare(value: string) {
  const username = value.replace(/^@+/, '').trim()
  return username ? `@${username}` : ''
}

function emptyToNull(value: string) {
  const normalized = value.trim()
  return normalized || null
}

function getContactSummary(contact: ApiContactAutocomplete) {
  return [contact.company, contact.phone, contact.email]
    .filter((value): value is string => Boolean(value))
    .join(' · ') || 'Контакт без дополнительных данных'
}

function formatAmount(amount: string | null, currency: string) {
  if (amount === null) return ''
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(numeric)
  const symbol = currency === 'RUB' ? '₽' : currency
  return `${formatted} ${symbol}`
}

function getRealtimeDealId(payload: RealtimePayload | null) {
  if (typeof payload?.deal_id === 'string') return payload.deal_id
  return typeof payload?.data?.deal_id === 'string' ? payload.data.deal_id : null
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
