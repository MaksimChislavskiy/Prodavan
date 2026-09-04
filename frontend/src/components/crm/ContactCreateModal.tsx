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
import { createContact, type CreateContactRequest } from '../../shared/api/contactsApi'
import { showCrmToast } from '../../shared/crmToast'
import {
  CONTACT_FIELD_LABELS,
  CONTACT_PLACEHOLDERS,
  getVisibleError,
  normalizeContactDraft,
  type ContactDraft,
  type ContactField,
} from './contactFormContract'
import './ContactFormModal.css'

const EMPTY_DRAFT: ContactDraft = {
  name: '',
  company: '',
  phone: '',
  email: '',
  telegram: '',
  comment: '',
}

const CLOSE_WARNING =
  'Вы действительно хотите закрыть окно? Все несохранённые изменения будут потеряны.'

type ContactCreateModalProps = {
  onClose: () => void
  onCreated: () => void
}

export function ContactCreateModal({ onClose, onCreated }: ContactCreateModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT)
  const [touchedFields, setTouchedFields] = useState<Set<ContactField>>(() => new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)

  const validation = useMemo(() => normalizeContactDraft(draft), [draft])
  const isDirty = Object.values(draft).some((value) => value.trim().length > 0)
  const canSubmit = Boolean(
    validation.values.name
      && Object.keys(validation.errors).length === 0
      && !isSaving,
  )

  const abortRequest = () => {
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
  }

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
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => firstInputRef.current?.focus(), 0)

    return () => {
      document.body.style.overflow = originalOverflow
      abortRequest()
    }
  }, [])

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
    if (!canSubmit || isSaving) return
    setIsSaving(true)
    setRequestError('')
    abortRequest()
    const controller = new AbortController()
    requestControllerRef.current = controller

    try {
      await createContact(
        validation.values satisfies CreateContactRequest,
        controller.signal,
      )
      if (controller.signal.aborted) return
      onCreated()
    } catch (error) {
      if (controller.signal.aborted) return
      if (
        error instanceof Error
        && error.message === 'Сервер не отвечает. Попробуйте позже.'
      ) {
        showCrmToast('Сервер не отвечает')
      } else {
        setRequestError(
          error instanceof Error
            ? error.message
            : 'Не удалось создать контакт. Проверьте данные.',
        )
      }
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null
      setIsSaving(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      setTouchedFields(new Set(Object.keys(CONTACT_FIELD_LABELS) as ContactField[]))
      return
    }
    void submit()
  }

  const handleFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (canSubmit) void submit()
    else setTouchedFields(new Set(Object.keys(CONTACT_FIELD_LABELS) as ContactField[]))
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) requestClose()
  }

  return (
    <div className="contact-form-overlay" role="presentation" onMouseDown={handleOverlayMouseDown}>
      <div
        className="contact-form-modal"
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
          <button
            type="button"
            aria-label="Закрыть"
            disabled={isSaving}
            onClick={requestClose}
          >
            ×
          </button>
        </header>

        <form className="contact-form" noValidate onSubmit={handleSubmit}>
          <div className="contact-form__grid">
            {(Object.keys(CONTACT_FIELD_LABELS) as ContactField[])
              .filter((field) => field !== 'comment')
              .map((field) => (
                <label className="contact-form__field" key={field}>
                  <span>
                    {CONTACT_FIELD_LABELS[field]}
                    {field === 'name' && <b aria-hidden="true">*</b>}
                  </span>
                  <input
                    ref={field === 'name' ? firstInputRef : undefined}
                    name={field}
                    type="text"
                    value={draft[field]}
                    placeholder={CONTACT_PLACEHOLDERS[field]}
                    maxLength={field === 'email' ? 255 : field === 'phone' || field === 'telegram' ? 64 : 100}
                    inputMode={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                    required={field === 'name'}
                    disabled={isSaving}
                    aria-invalid={Boolean(getVisibleError(field, touchedFields, validation.errors))}
                    onChange={updateField(field)}
                    onBlur={() => touchField(field)}
                    onKeyDown={handleFieldKeyDown}
                  />
                  {getVisibleError(field, touchedFields, validation.errors) && (
                    <em role="alert">{getVisibleError(field, touchedFields, validation.errors)}</em>
                  )}
                </label>
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

          {requestError && (
            <p className="contact-form__request-error" role="alert">
              {requestError}
            </p>
          )}

          <footer className="contact-form__actions">
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
          <DecisionDialog
            text={CLOSE_WARNING}
            onClose={() => setIsCloseConfirmOpen(false)}
            onConfirm={() => {
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

function DecisionDialog({
  text,
  onClose,
  onConfirm,
}: {
  text: string
  onClose: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const stayButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    stayButtonRef.current?.focus()
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const buttons = Array.from(
        dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
      )
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
  }, [onClose])

  return (
    <div className="contact-decision-overlay" role="presentation">
      <div
        className="contact-decision"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="contact-create-close-warning"
      >
        <p id="contact-create-close-warning">{text}</p>
        <div>
          <button ref={stayButtonRef} type="button" onClick={onClose}>
            Остаться
          </button>
          <button className="is-danger" type="button" onClick={onConfirm}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
