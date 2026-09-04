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
import { apiRequest } from '../../shared/api/apiClient'
import type { ApiContact } from '../../shared/api/contactsApi'
import { showCrmToast } from '../../shared/crmToast'
import {
  CONTACT_FIELD_LABELS,
  CONTACT_PLACEHOLDERS,
  EMPTY_CONTACT_DRAFT,
  getVisibleError,
  hasRawContactInput,
  normalizeContactDraft,
  type ContactDraft,
  type ContactField,
} from './contactFormContract'
import './ContactFormModal.css'
import './ContactCardModal.css'

type CreateContactModalProps = {
  onClose: () => void
  onCreated: (contact: ApiContact) => void
}

const CLOSE_WARNING =
  'Вы действительно хотите закрыть окно? Все несохранённые изменения будут потеряны.'

export function CreateContactModal({ onClose, onCreated }: CreateContactModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_CONTACT_DRAFT)
  const [touchedFields, setTouchedFields] = useState<Set<ContactField>>(
    () => new Set(),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)

  const validation = useMemo(() => normalizeContactDraft(draft), [draft])
  const canSubmit = Boolean(
    validation.values.name
      && Object.keys(validation.errors).length === 0
      && !isSaving,
  )
  const isDirty = hasRawContactInput(draft)

  const abortRequest = () => {
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
  }

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => nameInputRef.current?.focus(), 0)
    return () => {
      abortRequest()
      document.body.style.overflow = originalOverflow
    }
  }, [])

  const requestClose = () => {
    if (isSaving) return
    if (isDirty) {
      setIsCloseConfirmOpen(true)
      return
    }
    abortRequest()
    onClose()
  }

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isCloseConfirmOpen) return
      if (event.key === 'Escape') {
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

  const updateField = (field: ContactField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft((current) => ({ ...current, [field]: event.target.value }))
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
    if (isSaving) return
    if (!canSubmit) {
      setTouchedFields(new Set(Object.keys(CONTACT_FIELD_LABELS) as ContactField[]))
      return
    }

    abortRequest()
    const controller = new AbortController()
    requestControllerRef.current = controller
    setIsSaving(true)
    setRequestError('')

    try {
      const created = await apiRequest<ApiContact>('/api/contacts', {
        method: 'POST',
        body: validation.values,
        signal: controller.signal,
        timeoutMs: 30_000,
        suppressGlobalErrorToast: true,
      })
      if (controller.signal.aborted) return
      onCreated(created)
    } catch (error) {
      if (isAbortError(error)) return
      if (
        error instanceof Error
        && error.message === 'Сервер не отвечает. Попробуйте позже.'
      ) {
        showCrmToast('Сервер не отвечает')
      } else {
        setRequestError(
          error instanceof Error && error.message
            ? error.message
            : 'Не удалось создать контакт. Проверьте данные.',
        )
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
      }
      setIsSaving(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }

  const handleFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void submit()
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) requestClose()
  }

  return (
    <div className="contact-form-overlay" role="presentation" onMouseDown={handleOverlayMouseDown}>
      <div
        className="contact-form-modal contact-card-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-create-title"
        aria-busy={isSaving}
      >
        <header className="contact-form-modal__header">
          <div>
            <p>Новый клиент</p>
            <h2 id="contact-create-title">Добавить контакт</h2>
          </div>
          <div className="contact-card-modal__header-actions">
            <button
              type="button"
              aria-label="Закрыть"
              disabled={isSaving}
              onClick={requestClose}
            >
              ×
            </button>
          </div>
        </header>

        <form className="contact-form" noValidate onSubmit={handleSubmit}>
          <div className="contact-form__grid">
            {(Object.keys(CONTACT_FIELD_LABELS) as ContactField[])
              .filter((field) => field !== 'comment')
              .map((field) => (
                <CreateInput
                  key={field}
                  field={field}
                  value={draft[field]}
                  error={getVisibleError(field, touchedFields, validation.errors)}
                  disabled={isSaving}
                  inputRef={field === 'name' ? nameInputRef : undefined}
                  onChange={updateField(field)}
                  onBlur={() => touchField(field)}
                  onKeyDown={handleFieldKeyDown}
                />
              ))}

            <label className="contact-form__field contact-form__field--wide">
              <span>Комментарий</span>
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
              disabled
            >
              Перейти в чат
            </button>
            <button
              className="contact-form__button contact-form__button--primary"
              type="submit"
              disabled={!canSubmit}
            >
              {isSaving ? 'Сохранение...' : 'Добавить контакт'}
            </button>
          </footer>
        </form>

        {isCloseConfirmOpen && (
          <CreateDecisionDialog
            onStay={() => setIsCloseConfirmOpen(false)}
            onClose={() => {
              abortRequest()
              setIsCloseConfirmOpen(false)
              onClose()
            }}
          />
        )}
      </div>
    </div>
  )
}

function CreateInput({
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

function CreateDecisionDialog({
  onStay,
  onClose,
}: {
  onStay: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const stayRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    stayRef.current?.focus()
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onStay()
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
  }, [onStay])

  return (
    <div className="contact-decision-overlay" role="presentation">
      <div className="contact-decision" ref={dialogRef} role="alertdialog" aria-modal="true">
        <p>{CLOSE_WARNING}</p>
        <div>
          <button ref={stayRef} type="button" onClick={onStay}>Остаться</button>
          <button className="is-danger" type="button" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
