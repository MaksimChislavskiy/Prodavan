import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { ApiError } from '../../shared/api/apiClient'
import {
  getContact,
  updateContact,
  type ApiContact,
  type UpdateContactRequest,
} from '../../shared/api/contactsApi'
import { showCrmToast } from '../../shared/crmToast'
import {
  CONTACT_FIELD_LABELS,
  CONTACT_PLACEHOLDERS,
  contactToDraft,
  getContactChanges,
  getVisibleError,
  normalizeContactDraft,
  serializeNormalizedDraft,
  type ContactDraft,
  type ContactField,
} from './contactFormContract'
import './ContactFormModal.css'
import './ContactCardModal.css'

export type ContactModalMode = 'view' | 'edit'

type RealtimeContactModalProps = {
  contactId: string
  contactName?: string
  initialMode?: ContactModalMode
  onClose: () => void
  onUpdated?: (contact: ApiContact) => void
  onNotFound?: () => void
  onOpenRelatedDeals?: (contact: Pick<ApiContact, 'id' | 'name'>) => void
}

const CLOSE_WARNING =
  'Вы действительно хотите закрыть окно? Все несохранённые изменения будут потеряны.'
const CONFLICT_WARNING =
  'Контакт был изменён другим пользователем. Ваши изменения не сохранены. Обновить данные?'

export function RealtimeContactModal({
  contactId,
  contactName,
  initialMode = 'view',
  onClose,
  onUpdated,
  onNotFound,
  onOpenRelatedDeals,
}: RealtimeContactModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)
  const loadControllerRef = useRef<AbortController | null>(null)
  const saveControllerRef = useRef<AbortController | null>(null)
  const [mode, setMode] = useState<ContactModalMode>(initialMode)
  const [contact, setContact] = useState<ApiContact | null>(null)
  const [draft, setDraft] = useState<ContactDraft | null>(null)
  const [baseline, setBaseline] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [touchedFields, setTouchedFields] = useState<Set<ContactField>>(
    () => new Set(),
  )
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [isConflictConfirmOpen, setIsConflictConfirmOpen] = useState(false)

  const validation = useMemo(
    () => (draft ? normalizeContactDraft(draft) : null),
    [draft],
  )
  const isDirty = Boolean(
    mode === 'edit'
      && validation
      && baseline
      && serializeNormalizedDraft(validation.values) !== baseline,
  )
  const canSave = Boolean(
    mode === 'edit'
      && validation
      && validation.values.name
      && Object.keys(validation.errors).length === 0
      && isDirty
      && !isSaving
      && !isLoading,
  )

  const abortRequests = () => {
    loadControllerRef.current?.abort()
    saveControllerRef.current?.abort()
    loadControllerRef.current = null
    saveControllerRef.current = null
  }

  const hydrateEdit = (source: ApiContact) => {
    const nextDraft = contactToDraft(source)
    const normalized = normalizeContactDraft(nextDraft)
    setDraft(nextDraft)
    setBaseline(serializeNormalizedDraft(normalized.values))
    setTouchedFields(new Set())
    setRequestError('')
    window.setTimeout(() => firstInputRef.current?.focus(), 0)
  }

  const loadContact = async (targetMode: ContactModalMode = mode) => {
    loadControllerRef.current?.abort()
    const controller = new AbortController()
    loadControllerRef.current = controller
    setIsLoading(true)
    setLoadError('')

    try {
      const loaded = await getContact(contactId, controller.signal)
      if (controller.signal.aborted) return
      setContact(loaded)
      if (targetMode === 'edit') hydrateEdit(loaded)
    } catch (error) {
      if (isAbortError(error)) return
      if (error instanceof ApiError && error.status === 404) {
        showCrmToast('Контакт не найден или был удалён')
        onNotFound?.()
        onClose()
        return
      }
      setLoadError(
        error instanceof Error ? error.message : 'Не удалось загрузить контакт.',
      )
    } finally {
      if (loadControllerRef.current === controller) loadControllerRef.current = null
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadContact(initialMode)
    return abortRequests
    // initialMode is used only for the first opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  const requestClose = () => {
    if (isSaving || isLoading) return
    if (isDirty) {
      setIsCloseConfirmOpen(true)
      return
    }
    abortRequests()
    onClose()
  }

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isCloseConfirmOpen || isConflictConfirmOpen) return

      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }

      if (event.key !== 'Tab' || !modalRef.current) return
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]',
        ),
      )
      if (!focusable.length) return
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

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  const enterEdit = () => {
    if (!contact || isLoading) return
    setMode('edit')
    hydrateEdit(contact)
  }

  const updateField = (field: ContactField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value
      setDraft((current) => (current ? { ...current, [field]: value } : current))
      setRequestError('')
      setTouchedFields((current) => {
        if (!current.has(field)) return current
        const next = new Set(current)
        next.delete(field)
        return next
      })
    }

  const touchField = (field: ContactField) => {
    setTouchedFields((current) => new Set(current).add(field))
  }

  const submit = async () => {
    if (!draft || !validation || !canSave || !contact) return

    setIsSaving(true)
    setRequestError('')
    saveControllerRef.current?.abort()
    const controller = new AbortController()
    saveControllerRef.current = controller

    try {
      const initial = normalizeContactDraft(contactToDraft(contact)).values
      const changes = getContactChanges(initial, validation.values)
      const request: UpdateContactRequest = {
        version: contact.version,
        ...changes,
      }
      const updated = await updateContact(contactId, request, controller.signal)
      if (controller.signal.aborted) return

      setContact(updated)
      setMode('view')
      setDraft(null)
      setBaseline('')
      setTouchedFields(new Set())
      showCrmToast('Контакт обновлён')
      onUpdated?.(updated)
    } catch (error) {
      if (isAbortError(error)) return
      if (error instanceof ApiError && error.status === 409) {
        setIsConflictConfirmOpen(true)
      } else if (error instanceof ApiError && error.status === 404) {
        showCrmToast('Контакт не найден или был удалён')
        onNotFound?.()
        onClose()
      } else if (
        error instanceof Error
        && error.message === 'Сервер не отвечает. Попробуйте позже.'
      ) {
        showCrmToast('Сервер не отвечает')
      } else {
        setRequestError(
          error instanceof Error
            ? error.message
            : 'Не удалось обновить контакт. Проверьте данные.',
        )
      }
    } finally {
      if (saveControllerRef.current === controller) saveControllerRef.current = null
      setIsSaving(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validation) return
    if (!canSave) {
      setTouchedFields(new Set(Object.keys(CONTACT_FIELD_LABELS) as ContactField[]))
      return
    }
    void submit()
  }

  const handleFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (canSave) void submit()
  }

  const openChat = () => {
    abortRequests()
    window.location.assign(`/app/chats?contact_id=${encodeURIComponent(contactId)}`)
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) requestClose()
  }

  const title = mode === 'view' ? 'Просмотр контакта' : 'Редактировать контакт'

  return (
    <div className="contact-form-overlay" role="presentation" onMouseDown={handleOverlayMouseDown}>
      <div
        className="contact-form-modal contact-card-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-card-title"
        aria-busy={isLoading || isSaving}
      >
        <header className="contact-form-modal__header">
          <div>
            <p>{contact?.name || contactName || 'Контакт'}</p>
            <h2 id="contact-card-title">{title}</h2>
          </div>
          <div className="contact-card-modal__header-actions">
            {mode === 'view' && contact && (
              <button
                type="button"
                aria-label="Редактировать контакт"
                title="Редактировать"
                onClick={enterEdit}
              >
                ✎
              </button>
            )}
            <button
              type="button"
              aria-label="Закрыть"
              disabled={isLoading || isSaving}
              onClick={requestClose}
            >
              ×
            </button>
          </div>
        </header>

        {isLoading ? (
          <div className="contact-form-modal__loading" role="status">
            <span className="contact-form-modal__spinner" aria-hidden="true" />
            <p>Загружаем данные контакта…</p>
          </div>
        ) : loadError ? (
          <div className="contact-form-modal__loading" role="alert">
            <p>{loadError}</p>
            <button type="button" onClick={() => void loadContact(mode)}>Повторить</button>
          </div>
        ) : contact && mode === 'view' ? (
          <ContactViewFields contact={contact} />
        ) : draft && validation ? (
          <form className="contact-form" noValidate onSubmit={handleSubmit}>
            <div className="contact-form__grid">
              {(Object.keys(CONTACT_FIELD_LABELS) as ContactField[])
                .filter((field) => field !== 'comment')
                .map((field) => (
                  <ContactEditInput
                    key={field}
                    field={field}
                    value={draft[field]}
                    error={getVisibleError(field, touchedFields, validation.errors)}
                    disabled={isSaving}
                    inputRef={field === 'name' ? firstInputRef : undefined}
                    onChange={updateField(field)}
                    onBlur={() => touchField(field)}
                    onKeyDown={handleFieldKeyDown}
                  />
                ))}

              <label className="contact-form__field contact-form__field--wide">
                <span>{CONTACT_FIELD_LABELS.comment}</span>
                <textarea
                  value={draft.comment}
                  placeholder={CONTACT_PLACEHOLDERS.comment}
                  maxLength={500}
                  rows={4}
                  disabled={isSaving}
                  onChange={updateField('comment')}
                  onBlur={() => touchField('comment')}
                />
                <small className="contact-form__counter">{draft.comment.length}/500</small>
              </label>
            </div>

            {requestError && <p className="contact-form__request-error" role="alert">{requestError}</p>}

            <footer className="contact-card-modal__footer">
              <button
                className="contact-form__button contact-form__button--secondary"
                type="button"
                disabled={isSaving}
                onClick={openChat}
              >
                Перейти в чат
              </button>
              <button
                className="contact-form__button contact-form__button--primary"
                type="submit"
                disabled={!canSave}
              >
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </footer>
          </form>
        ) : null}

        {!isLoading && contact && mode === 'view' && (
          <footer className="contact-card-modal__view-footer">
            {onOpenRelatedDeals && (
              <button
                className="contact-form__button contact-form__button--secondary"
                type="button"
                onClick={() => onOpenRelatedDeals({ id: contact.id, name: contact.name })}
              >
                Связанные сделки
              </button>
            )}
            <button
              className="contact-form__button contact-form__button--primary"
              type="button"
              onClick={openChat}
            >
              Перейти в чат
            </button>
          </footer>
        )}

        {isCloseConfirmOpen && (
          <DecisionDialog
            text={CLOSE_WARNING}
            primaryLabel="Закрыть"
            secondaryLabel="Остаться"
            danger
            onPrimary={() => {
              abortRequests()
              setIsCloseConfirmOpen(false)
              onClose()
            }}
            onSecondary={() => setIsCloseConfirmOpen(false)}
          />
        )}

        {isConflictConfirmOpen && (
          <DecisionDialog
            text={CONFLICT_WARNING}
            primaryLabel="Обновить"
            secondaryLabel="Отмена"
            onPrimary={() => {
              setIsConflictConfirmOpen(false)
              void loadContact('edit')
            }}
            onSecondary={() => setIsConflictConfirmOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function ContactViewFields({ contact }: { contact: ApiContact }) {
  const fields: Array<[string, string | null]> = [
    ['ФИО', contact.name],
    ['Компания', contact.company],
    ['Рабочий телефон', contact.phone],
    ['E-mail', contact.email],
    ['Telegram', contact.telegram],
  ]

  return (
    <div className="contact-card-modal__view">
      <div className="contact-form__grid">
        {fields.map(([label, value]) => (
          <label className="contact-form__field" key={label}>
            <span>{label}</span>
            <input type="text" value={value ?? ''} readOnly aria-readonly="true" />
          </label>
        ))}
        <label className="contact-form__field contact-form__field--wide">
          <span>Комментарий</span>
          <textarea value={contact.comment ?? ''} rows={4} readOnly aria-readonly="true" />
        </label>
      </div>
    </div>
  )
}

function ContactEditInput({
  field,
  value,
  error,
  disabled,
  inputRef,
  onChange,
  onBlur,
  onKeyDown,
}: {
  field: Exclude<ContactField, 'comment'>
  value: string
  error?: string
  disabled: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  onBlur: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="contact-form__field">
      <span>
        {CONTACT_FIELD_LABELS[field]}
        {field === 'name' && <b aria-hidden="true">*</b>}
      </span>
      <input
        ref={inputRef}
        name={field}
        type="text"
        value={value}
        placeholder={CONTACT_PLACEHOLDERS[field]}
        maxLength={field === 'email' ? 255 : field === 'phone' || field === 'telegram' ? 64 : 100}
        inputMode={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={onChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      {error && <em role="alert">{error}</em>}
    </label>
  )
}

function DecisionDialog({
  text,
  primaryLabel,
  secondaryLabel,
  danger = false,
  onPrimary,
  onSecondary,
}: {
  text: string
  primaryLabel: string
  secondaryLabel: string
  danger?: boolean
  onPrimary: () => void
  onSecondary: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const secondaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    secondaryRef.current?.focus()
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onSecondary()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const buttons = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button'))
      if (!buttons.length) return
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onSecondary])

  return (
    <div className="contact-decision-overlay" role="presentation">
      <div className="contact-decision" ref={dialogRef} role="alertdialog" aria-modal="true">
        <p>{text}</p>
        <div>
          <button ref={secondaryRef} type="button" onClick={onSecondary}>{secondaryLabel}</button>
          <button className={danger ? 'is-danger' : 'is-primary'} type="button" onClick={onPrimary}>
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
