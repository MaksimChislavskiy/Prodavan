import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import {
  getContact,
  type ApiContact,
} from '../../shared/api/contactsApi'
import { ApiError } from '../../shared/api/apiClient'
import './ContactViewModal.css'

type ContactViewModalProps = {
  contactId: string
  contactName: string
  onClose: () => void
  onEdit: (contact: ApiContact) => void
  onNotFound: () => void
  onOpenRelatedDeals: (contact: Pick<ApiContact, 'id' | 'name'>) => void
}

type ContactViewState = {
  contact: ApiContact | null
  isLoading: boolean
  error: string
}

export function ContactViewModal({
  contactId,
  contactName,
  onClose,
  onEdit,
  onNotFound,
  onOpenRelatedDeals,
}: ContactViewModalProps) {
  const [state, setState] = useState<ContactViewState>({
    contact: null,
    isLoading: true,
    error: '',
  })
  const modalRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    const controller = new AbortController()
    document.body.style.overflow = 'hidden'

    async function loadContact() {
      setState({
        contact: null,
        isLoading: true,
        error: '',
      })

      try {
        const contact = await getContact(contactId, controller.signal)
        setState({
          contact,
          isLoading: false,
          error: '',
        })
        window.setTimeout(() => closeButtonRef.current?.focus(), 0)
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        if (error instanceof ApiError && error.status === 404) {
          onNotFound()
          return
        }

        setState({
          contact: null,
          isLoading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось загрузить контакт.',
        })
      }
    }

    void loadContact()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !modalRef.current) {
        return
      }

      const focusableElements = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href]',
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

    return () => {
      controller.abort()
      document.body.style.overflow = originalOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contactId, onClose, onNotFound, requestVersion])

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="contact-view-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
    >
      <article
        className="contact-view-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-view-title"
      >
        <header className="contact-view-modal__header">
          <div>
            <p>Карточка клиента</p>
            <h2 id="contact-view-title">Просмотр контакта</h2>
          </div>

          <div className="contact-view-modal__header-actions">
            {state.contact && (
              <button
                type="button"
                aria-label={`Редактировать контакт ${state.contact.name}`}
                title="Редактировать"
                onClick={() => onEdit(state.contact as ApiContact)}
              >
                ✎
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Закрыть"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        {state.isLoading && (
          <div className="contact-view-modal__state" role="status">
            <span className="contact-view-modal__spinner" aria-hidden="true" />
            <p>Загружаем контакт…</p>
          </div>
        )}

        {state.error && (
          <div className="contact-view-modal__state" role="alert">
            <p>{state.error}</p>
            <button
              type="button"
              onClick={() =>
                setRequestVersion((currentVersion) => currentVersion + 1)
              }
            >
              Повторить
            </button>
          </div>
        )}

        {state.contact && (
          <div className="contact-view-modal__content">
            <dl className="contact-view-modal__details">
              <ContactDetail label="ФИО" value={state.contact.name} />
              <ContactDetail label="Компания" value={state.contact.company} />
              <ContactDetail label="Телефон" value={state.contact.phone} />
              <ContactDetail label="E-mail" value={state.contact.email} />
            </dl>

            <div className="contact-view-modal__messenger">
              <span>Мессенджер</span>
              {state.contact.telegram ? (
                <a
                  href={`https://t.me/${state.contact.telegram.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <b aria-hidden="true">↗</b>
                  {state.contact.telegram}
                </a>
              ) : (
                <p>Не указан</p>
              )}
            </div>

            <div className="contact-view-modal__comment">
              <span>Комментарий</span>
              <p>{state.contact.comment || 'Комментарий не добавлен.'}</p>
            </div>

            <button
              className="contact-view-modal__deals-button"
              type="button"
              onClick={() =>
                onOpenRelatedDeals({
                  id: state.contact?.id ?? contactId,
                  name: state.contact?.name ?? contactName,
                })
              }
            >
              Связанные сделки
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}
      </article>
    </div>
  )
}

function ContactDetail({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || 'Не указано'}</dd>
    </div>
  )
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
