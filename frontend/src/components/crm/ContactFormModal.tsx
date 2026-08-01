import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from 'react'
import {
  createContact,
  getContact,
  updateContact,
  type ApiContact,
  type CreateContactRequest,
  type UpdateContactRequest,
} from '../../shared/api/contactsApi'
import { ApiError } from '../../shared/api/apiClient'
import './ContactFormModal.css'

type ContactFormModalProps = {
  mode: 'create' | 'edit'
  contactId?: string
  contactName?: string
  onClose: () => void
  onCreated: () => void
  onUpdated: () => void
  onNotFound: () => void
}

type ContactDraft = {
  name: string
  company: string
  phone: string
  email: string
  telegram: string
  comment: string
}

type ContactField = keyof ContactDraft
type ContactErrors = Partial<Record<ContactField, string>>

type NormalizedContactDraft = {
  name: string
  company: string | null
  phone: string | null
  email: string | null
  telegram: string | null
  comment: string | null
}

const emptyDraft: ContactDraft = {
  name: '',
  company: '',
  phone: '',
  email: '',
  telegram: '',
  comment: '',
}

const contactFieldLabels: Record<ContactField, string> = {
  name: 'ФИО',
  company: 'Компания',
  phone: 'Рабочий телефон',
  email: 'E-mail',
  telegram: 'Telegram',
  comment: 'Комментарий',
}

export function ContactFormModal({
  mode,
  contactId,
  contactName,
  onClose,
  onCreated,
  onUpdated,
  onNotFound,
}: ContactFormModalProps) {
  const [draft, setDraft] = useState<ContactDraft>(emptyDraft)
  const [initialDraft, setInitialDraft] = useState<ContactDraft>(emptyDraft)
  const [version, setVersion] = useState<number | null>(null)
  const [touchedFields, setTouchedFields] = useState<Set<ContactField>>(
    () => new Set(),
  )
  const [isLoading, setIsLoading] = useState(mode === 'edit')
  const [isSaving, setIsSaving] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [isConflictConfirmOpen, setIsConflictConfirmOpen] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const requestTimeoutRef = useRef<number | null>(null)
  const didRequestTimeoutRef = useRef(false)

  const validation = useMemo(() => normalizeContactDraft(draft), [draft])
  const initialValidation = useMemo(
    () => normalizeContactDraft(initialDraft),
    [initialDraft],
  )
  const isDirty =
    serializeNormalizedDraft(validation.values) !==
    serializeNormalizedDraft(initialValidation.values)
  const canSubmit =
    !isLoading &&
    !isSaving &&
    validation.values.name.length > 0 &&
    Object.keys(validation.errors).length === 0 &&
    (mode === 'create' || isDirty)

  const stopCurrentRequest = useCallback(() => {
    if (requestTimeoutRef.current !== null) {
      window.clearTimeout(requestTimeoutRef.current)
      requestTimeoutRef.current = null
    }

    requestControllerRef.current?.abort()
    requestControllerRef.current = null
  }, [])

  const startRequest = useCallback(() => {
    stopCurrentRequest()
    didRequestTimeoutRef.current = false

    const controller = new AbortController()
    requestControllerRef.current = controller
    requestTimeoutRef.current = window.setTimeout(() => {
      didRequestTimeoutRef.current = true
      controller.abort()
    }, 30_000)

    return controller
  }, [stopCurrentRequest])

  const finishRequest = useCallback(() => {
    if (requestTimeoutRef.current !== null) {
      window.clearTimeout(requestTimeoutRef.current)
      requestTimeoutRef.current = null
    }

    requestControllerRef.current = null
  }, [])

  const requestClose = useCallback(() => {
    if (isSaving) {
      return
    }

    if (isDirty) {
      setIsCloseConfirmOpen(true)
      return
    }

    stopCurrentRequest()
    onClose()
  }, [isDirty, isSaving, onClose, stopCurrentRequest])

  const loadContact = useCallback(async () => {
    if (mode !== 'edit' || !contactId) {
      return
    }

    setIsLoading(true)
    setRequestError('')
    const controller = startRequest()

    try {
      const contact = await getContact(contactId, controller.signal)
      const nextDraft = contactToDraft(contact)

      setDraft(nextDraft)
      setInitialDraft(nextDraft)
      setVersion(contact.version)
      setTouchedFields(new Set())

      window.setTimeout(() => nameInputRef.current?.focus(), 0)
    } catch (error) {
      if (didRequestTimeoutRef.current) {
        setRequestError('Сервер не отвечает. Попробуйте ещё раз.')
      } else if (isAbortError(error)) {
        return
      } else if (error instanceof ApiError && error.status === 404) {
        onNotFound()
      } else {
        setRequestError(
          error instanceof Error
            ? error.message
            : 'Не удалось загрузить контакт.',
        )
      }
    } finally {
      finishRequest()
      setIsLoading(false)
    }
  }, [
    contactId,
    finishRequest,
    mode,
    onNotFound,
    startRequest,
  ])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const setupTimeoutId = window.setTimeout(() => {
      if (mode === 'create') {
        nameInputRef.current?.focus()
      } else {
        void loadContact()
      }
    }, 0)

    return () => {
      document.body.style.overflow = originalOverflow
      window.clearTimeout(setupTimeoutId)
      stopCurrentRequest()
    }
  }, [loadContact, mode, stopCurrentRequest])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isCloseConfirmOpen || isConflictConfirmOpen) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }

      if (event.key !== 'Tab' || !modalRef.current) {
        return
      }

      const focusableElements = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
        ),
      )

      if (focusableElements.length === 0) {
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    isCloseConfirmOpen,
    isConflictConfirmOpen,
    requestClose,
  ])

  const closeWithoutSaving = () => {
    stopCurrentRequest()
    setIsCloseConfirmOpen(false)
    onClose()
  }

  const updateField =
    (field: ContactField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        [field]: event.target.value,
      }))
      setRequestError('')
      setTouchedFields((currentFields) => {
        if (!currentFields.has(field)) {
          return currentFields
        }

        const nextFields = new Set(currentFields)
        nextFields.delete(field)
        return nextFields
      })
    }

  const touchField = (field: ContactField) => {
    setTouchedFields((currentFields) => new Set(currentFields).add(field))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isLoading || isSaving) {
      return
    }

    if (!canSubmit) {
      setTouchedFields(new Set(Object.keys(contactFieldLabels) as ContactField[]))
      return
    }

    if (mode === 'edit' && (!contactId || version === null)) {
      setRequestError('Не удалось определить версию контакта. Обновите данные.')
      return
    }

    setIsSaving(true)
    setRequestError('')
    const controller = startRequest()

    try {
      if (mode === 'create') {
        await createContact(
          validation.values satisfies CreateContactRequest,
          controller.signal,
        )
        onCreated()
      } else {
        const changes = getContactChanges(
          initialValidation.values,
          validation.values,
        )
        const request: UpdateContactRequest = {
          version: version as number,
          ...changes,
        }

        await updateContact(contactId as string, request, controller.signal)
        onUpdated()
      }
    } catch (error) {
      if (didRequestTimeoutRef.current) {
        setRequestError('Сервер не отвечает. Попробуйте ещё раз.')
      } else if (isAbortError(error)) {
        return
      } else if (
        mode === 'edit' &&
        error instanceof ApiError &&
        error.status === 409
      ) {
        setIsConflictConfirmOpen(true)
      } else if (
        mode === 'edit' &&
        error instanceof ApiError &&
        error.status === 404
      ) {
        onNotFound()
      } else {
        setRequestError(
          error instanceof Error
            ? error.message
            : mode === 'create'
              ? 'Не удалось создать контакт. Проверьте данные.'
              : 'Не удалось обновить контакт. Проверьте данные.',
        )
      }
    } finally {
      finishRequest()
      setIsSaving(false)
    }
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      requestClose()
    }
  }

  const title =
    mode === 'create' ? 'Создание контакта' : 'Редактирование контакта'

  return (
    <div
      className="contact-form-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className="contact-form-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-form-title"
        aria-busy={isLoading || isSaving}
      >
        <header className="contact-form-modal__header">
          <div>
            <p>{mode === 'create' ? 'Новый клиент' : contactName || 'Контакт'}</p>
            <h2 id="contact-form-title">{title}</h2>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            disabled={isSaving}
            onClick={requestClose}
          >
            ×
          </button>
        </header>

        {isLoading || (mode === 'edit' && version === null) ? (
          <div className="contact-form-modal__loading" role="status">
            {isLoading ? (
              <>
                <span
                  className="contact-form-modal__spinner"
                  aria-hidden="true"
                />
                <p>Загружаем данные контакта…</p>
              </>
            ) : (
              <p>{requestError || 'Не удалось загрузить контакт.'}</p>
            )}
            {!isLoading && requestError && (
              <button type="button" onClick={() => void loadContact()}>
                Повторить
              </button>
            )}
          </div>
        ) : (
          <form
            className="contact-form"
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
          >
            <div className="contact-form__grid">
              <ContactInput
                field="name"
                label="ФИО"
                placeholder="Введите ФИО"
                value={draft.name}
                error={getVisibleError('name', touchedFields, validation.errors)}
                required
                maxLength={100}
                disabled={isSaving}
                inputRef={nameInputRef}
                onChange={updateField('name')}
                onBlur={() => touchField('name')}
              />

              <ContactInput
                field="company"
                label="Компания"
                placeholder="Введите компанию"
                value={draft.company}
                error={getVisibleError('company', touchedFields, validation.errors)}
                maxLength={100}
                disabled={isSaving}
                onChange={updateField('company')}
                onBlur={() => touchField('company')}
              />

              <ContactInput
                field="phone"
                label="Рабочий телефон"
                placeholder="Введите номер телефона"
                value={draft.phone}
                error={getVisibleError('phone', touchedFields, validation.errors)}
                inputMode="tel"
                maxLength={64}
                disabled={isSaving}
                onChange={updateField('phone')}
                onBlur={() => touchField('phone')}
              />

              <ContactInput
                field="email"
                label="E-mail"
                placeholder="Введите email"
                value={draft.email}
                error={getVisibleError('email', touchedFields, validation.errors)}
                inputMode="email"
                maxLength={255}
                disabled={isSaving}
                onChange={updateField('email')}
                onBlur={() => touchField('email')}
              />

              <ContactInput
                field="telegram"
                label="Telegram"
                placeholder="Введите никнейм Telegram"
                value={draft.telegram}
                error={getVisibleError('telegram', touchedFields, validation.errors)}
                maxLength={64}
                disabled={isSaving}
                onChange={updateField('telegram')}
                onBlur={() => touchField('telegram')}
              />

              <label className="contact-form__field contact-form__field--wide">
                <span>Комментарий</span>
                <textarea
                  value={draft.comment}
                  placeholder="Написать..."
                  maxLength={500}
                  rows={4}
                  disabled={isSaving}
                  aria-invalid={
                    Boolean(
                      getVisibleError(
                        'comment',
                        touchedFields,
                        validation.errors,
                      ),
                    )
                  }
                  onChange={updateField('comment')}
                  onBlur={() => touchField('comment')}
                />
                <small className="contact-form__counter">
                  {draft.comment.length}/500
                </small>
                {getVisibleError(
                  'comment',
                  touchedFields,
                  validation.errors,
                ) && (
                  <em role="alert">
                    {getVisibleError(
                      'comment',
                      touchedFields,
                      validation.errors,
                    )}
                  </em>
                )}
              </label>
            </div>

            {requestError && (
              <p className="contact-form__request-error" role="alert">
                {requestError}
              </p>
            )}

            <footer className="contact-form__actions">
              <button
                className="contact-form__button contact-form__button--secondary"
                type="button"
                disabled={isSaving}
                onClick={requestClose}
              >
                Отмена
              </button>
              <button
                className="contact-form__button contact-form__button--primary"
                type="submit"
                disabled={!canSubmit}
              >
                {isSaving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </footer>
          </form>
        )}

        {isCloseConfirmOpen && (
          <ContactDecisionDialog
            title="Закрыть окно?"
            text="Все несохранённые изменения будут потеряны."
            primaryLabel="Закрыть"
            secondaryLabel="Остаться"
            danger
            onPrimary={closeWithoutSaving}
            onSecondary={() => setIsCloseConfirmOpen(false)}
          />
        )}

        {isConflictConfirmOpen && (
          <ContactDecisionDialog
            title="Контакт был изменён"
            text="Ваши изменения не сохранены. Обновить форму актуальными данными?"
            primaryLabel="Обновить"
            secondaryLabel="Отмена"
            onPrimary={() => {
              setIsConflictConfirmOpen(false)
              void loadContact()
            }}
            onSecondary={() => setIsConflictConfirmOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function ContactInput({
  field,
  label,
  placeholder,
  value,
  error,
  required = false,
  maxLength,
  inputMode,
  disabled,
  inputRef,
  onChange,
  onBlur,
}: {
  field: ContactField
  label: string
  placeholder: string
  value: string
  error?: string
  required?: boolean
  maxLength: number
  inputMode?: 'email' | 'tel' | 'text'
  disabled: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  onBlur: () => void
}) {
  return (
    <label className="contact-form__field">
      <span>
        {label}
        {required && <b aria-hidden="true">*</b>}
      </span>
      <input
        ref={inputRef}
        name={field}
        type="text"
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={onChange}
        onBlur={onBlur}
      />
      {error && <em role="alert">{error}</em>}
    </label>
  )
}

function ContactDecisionDialog({
  title,
  text,
  primaryLabel,
  secondaryLabel,
  danger = false,
  onPrimary,
  onSecondary,
}: {
  title: string
  text: string
  primaryLabel: string
  secondaryLabel: string
  danger?: boolean
  onPrimary: () => void
  onSecondary: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const secondaryButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    secondaryButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onSecondary()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) {
        return
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLButtonElement>(
          'button:not([disabled])',
        ),
      )

      if (focusableElements.length === 0) {
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onSecondary])

  return (
    <div className="contact-decision-overlay" role="presentation">
      <div
        className="contact-decision"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="contact-decision-title"
        aria-describedby="contact-decision-text"
      >
        <h3 id="contact-decision-title">{title}</h3>
        <p id="contact-decision-text">{text}</p>
        <div>
          <button
            ref={secondaryButtonRef}
            type="button"
            onClick={onSecondary}
          >
            {secondaryLabel}
          </button>
          <button
            className={danger ? 'is-danger' : 'is-primary'}
            type="button"
            onClick={onPrimary}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function normalizeContactDraft(draft: ContactDraft): {
  values: NormalizedContactDraft
  errors: ContactErrors
} {
  const errors: ContactErrors = {}
  const name = draft.name.trim()
  const company = normalizeNullableText(draft.company)
  const email = normalizeNullableText(draft.email)?.toLowerCase() ?? null
  const comment = normalizeNullableText(draft.comment)
  let phone = normalizeNullableText(draft.phone)
  let telegram = normalizeNullableText(draft.telegram)

  if (!name) {
    errors.name = 'Заполните поле.'
  } else if (name.length > 100) {
    errors.name = 'ФИО должно содержать не больше 100 символов.'
  } else if (!/^[A-Za-zА-Яа-яЁё -]+$/.test(name)) {
    errors.name = 'Допустимы только буквы, пробелы и дефисы.'
  }

  if (company && company.length > 100) {
    errors.company = 'Название компании должно содержать не больше 100 символов.'
  }

  if (phone) {
    phone = phone.replace(/[\s()-]/g, '')

    if (phone.startsWith('+')) {
      const digits = phone.slice(1)

      if (!/^\d{7,15}$/.test(digits)) {
        errors.phone = 'Введите номер, содержащий от 7 до 15 цифр.'
      }
    } else if (/^\d{11}$/.test(phone) && phone.startsWith('8')) {
      phone = `+7${phone.slice(1)}`
    } else if (/^\d{10}$/.test(phone)) {
      phone = `+7${phone}`
    } else if (!/^\d{7,15}$/.test(phone)) {
      errors.phone = 'Введите корректный номер телефона.'
    }
  }

  if (email) {
    if (email.length > 255) {
      errors.email = 'E-mail должен содержать не больше 255 символов.'
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.email = 'Введите корректный e-mail.'
    }
  }

  if (telegram) {
    const username = telegram.replace(/^@+/, '')

    if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
      errors.telegram = 'Введите 5–32 латинских символа, цифры или _.'
    }

    telegram = `@${username}`
  }

  if (comment && comment.length > 500) {
    errors.comment = 'Комментарий должен содержать не больше 500 символов.'
  }

  return {
    values: {
      name,
      company,
      phone,
      email,
      telegram,
      comment,
    },
    errors,
  }
}

function getContactChanges(
  initialValues: NormalizedContactDraft,
  currentValues: NormalizedContactDraft,
) {
  const changes: Omit<UpdateContactRequest, 'version'> = {}

  for (const field of Object.keys(currentValues) as ContactField[]) {
    if (currentValues[field] !== initialValues[field]) {
      Object.assign(changes, {
        [field]: currentValues[field],
      })
    }
  }

  return changes
}

function contactToDraft(contact: ApiContact): ContactDraft {
  return {
    name: contact.name,
    company: contact.company ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    telegram: contact.telegram ?? '',
    comment: contact.comment ?? '',
  }
}

function normalizeNullableText(value: string) {
  const normalizedValue = value.trim()
  return normalizedValue || null
}

function serializeNormalizedDraft(draft: NormalizedContactDraft) {
  return JSON.stringify(draft)
}

function getVisibleError(
  field: ContactField,
  touchedFields: Set<ContactField>,
  errors: ContactErrors,
) {
  return touchedFields.has(field) ? errors[field] : undefined
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
