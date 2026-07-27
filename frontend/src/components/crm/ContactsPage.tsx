import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import {
  bulkDeleteContacts,
  deleteContact,
  getContacts,
  type ApiContact,
  type ApiContactsResponse,
} from '../../shared/api/contactsApi'
import { ApiError } from '../../shared/api/apiClient'
import { ContactFormModal } from './ContactFormModal'
import { ContactViewModal } from './ContactViewModal'
import './ContactsPage.css'

const CONTACTS_PAGE_SIZE = 20

type ContactsPageProps = {
  onOpenRelatedDeals: (contact: Pick<ApiContact, 'id' | 'name'>) => void
}

type ContactsState = {
  data: ApiContactsResponse | null
  isLoading: boolean
  error: string
}

type ContactDialog =
  | { mode: 'create' }
  | { mode: 'view'; contactId: string; contactName: string }
  | { mode: 'edit'; contactId: string; contactName: string }

type DeleteRequest =
  | { kind: 'single'; contact: ApiContact }
  | { kind: 'bulk'; contacts: ApiContact[] }

const initialState: ContactsState = {
  data: null,
  isLoading: true,
  error: '',
}

export function ContactsPage({ onOpenRelatedDeals }: ContactsPageProps) {
  const [state, setState] = useState<ContactsState>(initialState)
  const [page, setPage] = useState(1)
  const [requestVersion, setRequestVersion] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [openMenuId, setOpenMenuId] = useState('')
  const [dialog, setDialog] = useState<ContactDialog | null>(null)
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadContacts() {
      setState((currentState) => ({
        ...currentState,
        isLoading: true,
        error: '',
      }))

      try {
        const data = await getContacts(page, CONTACTS_PAGE_SIZE, controller.signal)

        if (data.contacts.length === 0 && data.total > 0 && page > 1) {
          setPage((currentPage) => Math.max(1, currentPage - 1))
          return
        }

        setState({
          data,
          isLoading: false,
          error: '',
        })
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        setState({
          data: null,
          isLoading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось загрузить список контактов.',
        })
      }
    }

    void loadContacts()

    return () => controller.abort()
  }, [page, requestVersion])

  useEffect(() => {
    if (!toast) {
      return
    }

    const timeoutId = window.setTimeout(() => setToast(''), 5000)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  useEffect(() => {
    if (!openMenuId) {
      return
    }

    const closeMenu = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.contacts-row-menu')
      ) {
        return
      }

      setOpenMenuId('')
    }

    const closeMenuByKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuId('')
      }
    }

    document.addEventListener('pointerdown', closeMenu, true)
    document.addEventListener('keydown', closeMenuByKeyboard)

    return () => {
      document.removeEventListener('pointerdown', closeMenu, true)
      document.removeEventListener('keydown', closeMenuByKeyboard)
    }
  }, [openMenuId])

  const contacts = useMemo(
    () => state.data?.contacts ?? [],
    [state.data?.contacts],
  )
  const totalPages = Math.max(
    1,
    Math.ceil((state.data?.total ?? 0) / CONTACTS_PAGE_SIZE),
  )
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedIds.has(contact.id)),
    [contacts, selectedIds],
  )
  const areAllContactsSelected =
    contacts.length > 0 && contacts.every((contact) => selectedIds.has(contact.id))

  const reloadContacts = () => {
    setSelectedIds(new Set())
    setOpenMenuId('')
    setRequestVersion((currentVersion) => currentVersion + 1)
  }

  const changePage = (nextPage: number) => {
    setSelectedIds(new Set())
    setOpenMenuId('')
    setPage(nextPage)
  }

  const toggleContact = (contactId: string) => {
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds)

      if (nextIds.has(contactId)) {
        nextIds.delete(contactId)
      } else {
        nextIds.add(contactId)
      }

      return nextIds
    })
  }

  const toggleAllContacts = () => {
    if (areAllContactsSelected) {
      setSelectedIds(new Set())
      return
    }

    setSelectedIds(new Set(contacts.map((contact) => contact.id)))
  }

  const openDeleteConfirmation = (request: DeleteRequest) => {
    setOpenMenuId('')
    setDeleteError('')
    setDeleteRequest(request)
  }

  const closeDeleteConfirmation = () => {
    if (isDeleting) {
      return
    }

    setDeleteRequest(null)
    setDeleteError('')
  }

  const confirmDelete = async () => {
    if (!deleteRequest || isDeleting) {
      return
    }

    setIsDeleting(true)
    setDeleteError('')

    try {
      if (deleteRequest.kind === 'single') {
        await deleteContact(deleteRequest.contact.id)
        setToast('Контакт удалён.')
      } else {
        const result = await bulkDeleteContacts(
          deleteRequest.contacts.map((contact) => contact.id),
        )
        setToast(
          `Удалено ${result.deleted_count} контактов. Пропущено ${result.skipped_ids.length}.`,
        )
      }

      setDeleteRequest(null)
      setSelectedIds(new Set())
      reloadContacts()
    } catch (error) {
      if (
        deleteRequest.kind === 'single' &&
        error instanceof ApiError &&
        error.status === 404
      ) {
        setDeleteRequest(null)
        setToast('Контакт не найден или уже был удалён.')
        reloadContacts()
      } else {
        setDeleteError(
          error instanceof Error
            ? error.message
            : 'Не удалось удалить контакты. Попробуйте позже.',
        )
      }
    } finally {
      setIsDeleting(false)
    }
  }

  const handleContactCreated = () => {
    setDialog(null)
    setToast(
      'Контакт создан. Он может находиться на другой странице согласно сортировке.',
    )
    reloadContacts()
  }

  const handleContactUpdated = () => {
    setDialog(null)
    setToast('Контакт обновлён.')
    reloadContacts()
  }

  const handleContactNotFound = () => {
    setDialog(null)
    setToast('Контакт не найден или был удалён.')
    reloadContacts()
  }

  if (state.isLoading) {
    return <ContactsSkeleton />
  }

  if (state.error || !state.data) {
    return (
      <section className="contacts-state" aria-live="polite">
        <h1>Не удалось загрузить список контактов</h1>
        <p>
          {state.error || 'Попробуйте обновить страницу или повторить запрос.'}
        </p>
        <button type="button" onClick={reloadContacts}>
          Повторить
        </button>
      </section>
    )
  }

  return (
    <>
      <section className="contacts-page" aria-labelledby="contacts-page-title">
        <header className="contacts-page__header">
          <div>
            <p className="contacts-page__eyebrow">Клиентская база</p>
            <h1 id="contacts-page-title">Все контакты</h1>
          </div>

          <button
            className="contacts-page__add-button"
            type="button"
            onClick={() => setDialog({ mode: 'create' })}
          >
            <span aria-hidden="true">+</span>
            Добавить контакт
          </button>
        </header>

        {selectedContacts.length > 0 && (
          <div className="contacts-bulk-panel" aria-live="polite">
            <span>Выбрано: {selectedContacts.length}</span>
            <button
              type="button"
              disabled={selectedContacts.length > 100}
              title={
                selectedContacts.length > 100
                  ? 'Можно удалить не более 100 контактов за раз'
                  : undefined
              }
              onClick={() =>
                openDeleteConfirmation({
                  kind: 'bulk',
                  contacts: selectedContacts,
                })
              }
            >
              Удалить выбранные
            </button>
          </div>
        )}

        <div className="contacts-table-card">
          {contacts.length === 0 ? (
            <div className="contacts-empty">
              <span className="contacts-empty__icon" aria-hidden="true">
                ◎
              </span>
              <h2>Контакты отсутствуют</h2>
              <p>Добавьте первый контакт, чтобы начать формировать клиентскую базу.</p>
              <button type="button" onClick={() => setDialog({ mode: 'create' })}>
                Добавить контакт
              </button>
            </div>
          ) : (
            <div className="contacts-table-scroll">
              <table className="contacts-table">
                <thead>
                  <tr>
                    <th className="contacts-table__select-cell" scope="col">
                      <SelectAllCheckbox
                        checked={areAllContactsSelected}
                        indeterminate={
                          selectedContacts.length > 0 && !areAllContactsSelected
                        }
                        onChange={toggleAllContacts}
                      />
                    </th>
                    <th scope="col">ФИО</th>
                    <th scope="col">Телефон</th>
                    <th scope="col">E-mail</th>
                    <th className="contacts-table__actions-heading" scope="col">
                      <span className="contacts-visually-hidden">Действия</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr
                      className={selectedIds.has(contact.id) ? 'is-selected' : ''}
                      key={contact.id}
                    >
                      <td className="contacts-table__select-cell">
                        <input
                          type="checkbox"
                          aria-label={`Выбрать контакт ${contact.name}`}
                          checked={selectedIds.has(contact.id)}
                          onChange={() => toggleContact(contact.id)}
                        />
                      </td>
                      <td>
                        <button
                          className="contacts-table__name-button"
                          type="button"
                          title={contact.company || contact.name}
                          onClick={() =>
                            setDialog({
                              mode: 'view',
                              contactId: contact.id,
                              contactName: contact.name,
                            })
                          }
                        >
                          <span>{contact.name}</span>
                          {contact.company && <small>{contact.company}</small>}
                        </button>
                      </td>
                      <td>{contact.phone || <EmptyValue />}</td>
                      <td>{contact.email || <EmptyValue />}</td>
                      <td className="contacts-table__actions-cell">
                        <div className="contacts-row-menu">
                          <button
                            className="contacts-row-menu__trigger"
                            type="button"
                            aria-label={`Действия с контактом ${contact.name}`}
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === contact.id}
                            onClick={() =>
                              setOpenMenuId((currentId) =>
                                currentId === contact.id ? '' : contact.id,
                              )
                            }
                          >
                            ⋮
                          </button>

                          {openMenuId === contact.id && (
                            <div
                              className="contacts-row-menu__popup"
                              role="menu"
                              aria-label={`Действия с контактом ${contact.name}`}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenuId('')
                                  setDialog({
                                    mode: 'view',
                                    contactId: contact.id,
                                    contactName: contact.name,
                                  })
                                }}
                              >
                                Просмотреть
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenuId('')
                                  setDialog({
                                    mode: 'edit',
                                    contactId: contact.id,
                                    contactName: contact.name,
                                  })
                                }}
                              >
                                Редактировать
                              </button>
                              <button
                                className="contacts-row-menu__danger"
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  openDeleteConfirmation({
                                    kind: 'single',
                                    contact,
                                  })
                                }
                              >
                                Удалить
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {contacts.length > 0 && (
          <nav className="contacts-pagination" aria-label="Пагинация контактов">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => changePage(Math.max(1, page - 1))}
            >
              <span aria-hidden="true">←</span>
              Предыдущая
            </button>

            <span>
              Страница <strong>{page}</strong> из {totalPages}
            </span>

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => changePage(Math.min(totalPages, page + 1))}
            >
              Следующая
              <span aria-hidden="true">→</span>
            </button>
          </nav>
        )}
      </section>

      {dialog?.mode === 'create' && (
        <ContactFormModal
          mode="create"
          onClose={() => setDialog(null)}
          onCreated={handleContactCreated}
          onUpdated={handleContactUpdated}
          onNotFound={handleContactNotFound}
        />
      )}

      {dialog?.mode === 'edit' && (
        <ContactFormModal
          mode="edit"
          contactId={dialog.contactId}
          contactName={dialog.contactName}
          onClose={() => setDialog(null)}
          onCreated={handleContactCreated}
          onUpdated={handleContactUpdated}
          onNotFound={handleContactNotFound}
        />
      )}

      {dialog?.mode === 'view' && (
        <ContactViewModal
          contactId={dialog.contactId}
          contactName={dialog.contactName}
          onClose={() => setDialog(null)}
          onEdit={(contact) =>
            setDialog({
              mode: 'edit',
              contactId: contact.id,
              contactName: contact.name,
            })
          }
          onNotFound={handleContactNotFound}
          onOpenRelatedDeals={(contact) => {
            setDialog(null)
            onOpenRelatedDeals(contact)
          }}
        />
      )}

      {deleteRequest && (
        <ContactDeleteConfirmModal
          request={deleteRequest}
          isDeleting={isDeleting}
          error={deleteError}
          onCancel={closeDeleteConfirmation}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {toast && (
        <div className="contacts-toast" role="status">
          <span aria-hidden="true">✓</span>
          <p>{toast}</p>
          <button type="button" aria-label="Закрыть уведомление" onClick={() => setToast('')}>
            ×
          </button>
        </div>
      )}
    </>
  )
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
}) {
  const checkboxRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      aria-label="Выделить все контакты на текущей странице"
      checked={checked}
      onChange={onChange}
    />
  )
}

function EmptyValue() {
  return <span className="contacts-table__empty-value">—</span>
}

function ContactsSkeleton() {
  return (
    <section className="contacts-page contacts-page--loading" aria-busy="true">
      <header className="contacts-page__header">
        <div>
          <span className="contacts-skeleton contacts-skeleton--eyebrow" />
          <span className="contacts-skeleton contacts-skeleton--title" />
        </div>
        <span className="contacts-skeleton contacts-skeleton--button" />
      </header>

      <div className="contacts-table-card">
        <div className="contacts-skeleton-table">
          <span className="contacts-skeleton contacts-skeleton--head" />
          {Array.from({ length: 5 }, (_, index) => (
            <span
              className="contacts-skeleton contacts-skeleton--row"
              key={index}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function ContactDeleteConfirmModal({
  request,
  isDeleting,
  error,
  onCancel,
  onConfirm,
}: {
  request: DeleteRequest
  isDeleting: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const modalRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const count = request.kind === 'single' ? 1 : request.contacts.length
  const title =
    request.kind === 'single'
      ? 'Удалить контакт?'
      : `Удалить выбранные контакты (${count} шт.)?`

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) {
        event.preventDefault()
        onCancel()
        return
      }

      if (event.key !== 'Tab' || !modalRef.current) {
        return
      }

      const focusableElements = Array.from(
        modalRef.current.querySelectorAll<HTMLButtonElement>(
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

    return () => {
      document.body.style.overflow = originalOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isDeleting, onCancel])

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isDeleting) {
      onCancel()
    }
  }

  return (
    <div
      className="contact-confirm-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className="contact-confirm"
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="contact-delete-title"
        aria-describedby="contact-delete-description"
      >
        <span className="contact-confirm__icon" aria-hidden="true">
          !
        </span>
        <h2 id="contact-delete-title">{title}</h2>
        <p id="contact-delete-description">
          Действие невозможно отменить. Все связанные сделки потеряют ссылку на
          контакт.
        </p>

        {error && (
          <p className="contact-confirm__error" role="alert">
            {error}
          </p>
        )}

        <div className="contact-confirm__actions">
          <button
            ref={cancelButtonRef}
            className="contact-confirm__button contact-confirm__button--secondary"
            type="button"
            disabled={isDeleting}
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            className="contact-confirm__button contact-confirm__button--danger"
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? 'Удаление…' : 'Удалить'}
          </button>
        </div>
      </div>
    </div>
  )
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
