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
import { CreateContactModal } from './CreateContactModal'
import { RealtimeContactModal } from './RealtimeContactModal'
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
  | { mode: 'view' | 'edit'; contactId: string; contactName: string }

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
      setState((current) => ({ ...current, isLoading: true, error: '' }))
      try {
        const data = await getContacts(page, CONTACTS_PAGE_SIZE, controller.signal)
        if (controller.signal.aborted) return

        if (data.contacts.length === 0 && data.total > 0 && page > 1) {
          setPage((currentPage) => Math.max(1, currentPage - 1))
          return
        }

        setState({ data, isLoading: false, error: '' })
      } catch (error) {
        if (isAbortError(error)) return
        setState((current) => ({
          data: current.data,
          isLoading: false,
          error: error instanceof Error
            ? error.message
            : 'Не удалось загрузить список контактов. Попробуйте обновить страницу',
        }))
      }
    }

    void loadContacts()
    return () => controller.abort()
  }, [page, requestVersion])

  useEffect(() => {
    if (!toast) return
    const timeoutId = window.setTimeout(() => setToast(''), 5000)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  useEffect(() => {
    if (!openMenuId) return
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.contacts-row-menu')) return
      setOpenMenuId('')
    }
    const closeByKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId('')
    }
    document.addEventListener('pointerdown', closeMenu, true)
    document.addEventListener('keydown', closeByKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeMenu, true)
      document.removeEventListener('keydown', closeByKeyboard)
    }
  }, [openMenuId])

  const contacts = useMemo(() => state.data?.contacts ?? [], [state.data?.contacts])
  const totalPages = Math.max(1, Math.ceil((state.data?.total ?? 0) / CONTACTS_PAGE_SIZE))
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedIds.has(contact.id)),
    [contacts, selectedIds],
  )
  const areAllContactsSelected =
    contacts.length > 0 && contacts.every((contact) => selectedIds.has(contact.id))

  const reloadContacts = () => {
    setSelectedIds(new Set())
    setOpenMenuId('')
    setRequestVersion((current) => current + 1)
  }

  const changePage = (nextPage: number) => {
    setSelectedIds(new Set())
    setOpenMenuId('')
    setPage(nextPage)
  }

  const toggleContact = (contactId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
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

  const confirmDelete = async () => {
    if (!deleteRequest || isDeleting) return
    setIsDeleting(true)
    setDeleteError('')

    try {
      if (deleteRequest.kind === 'single') {
        await deleteContact(deleteRequest.contact.id)
        setToast('Контакт удалён')
      } else {
        const result = await bulkDeleteContacts(
          deleteRequest.contacts.map((contact) => contact.id),
        )
        setToast(
          `Удалено ${result.deleted_count} контактов. Пропущено ${result.skipped_ids.length} (не найдены или уже удалены)`,
        )
      }
      setDeleteRequest(null)
      setSelectedIds(new Set())
      reloadContacts()
    } catch (error) {
      if (
        deleteRequest.kind === 'single'
        && error instanceof ApiError
        && error.status === 404
      ) {
        setDeleteRequest(null)
        setToast('Контакт не найден или уже был удалён')
        reloadContacts()
      } else {
        setDeleteError('Не удалось удалить контакты. Попробуйте позже.')
      }
    } finally {
      setIsDeleting(false)
    }
  }

  const handleContactCreated = () => {
    setDialog(null)
    setToast('Контакт создан. Он может находиться на другой странице согласно сортировке.')
    reloadContacts()
  }

  const handleContactNotFound = () => {
    setDialog(null)
    reloadContacts()
  }

  if (state.isLoading && !state.data) return <ContactsSkeleton />

  if (state.error && !state.data) {
    return (
      <section className="contacts-state" aria-live="polite">
        <h1>Не удалось загрузить список контактов. Попробуйте обновить страницу</h1>
        <button type="button" onClick={reloadContacts}>Повторить</button>
      </section>
    )
  }

  return (
    <>
      <section className="contacts-page" aria-labelledby="contacts-page-title">
        <header className="contacts-page__header">
          <div>
            <p className="contacts-page__eyebrow">Клиентская база</p>
            <h1 id="contacts-page-title">Контакты</h1>
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

        {state.error && (
          <div className="contacts-state" role="alert">
            <p>Не удалось обновить список контактов. Попробуйте обновить страницу</p>
            <button type="button" onClick={reloadContacts}>Повторить</button>
          </div>
        )}

        {selectedContacts.length > 0 && (
          <div className="contacts-bulk-panel" aria-live="polite">
            <span>Выбрано {selectedContacts.length} контактов</span>
            <button
              type="button"
              disabled={selectedContacts.length > 100}
              onClick={() => openDeleteConfirmation({ kind: 'bulk', contacts: selectedContacts })}
            >
              Удалить выбранные
            </button>
          </div>
        )}

        <div className="contacts-table-card">
          {contacts.length === 0 ? (
            <div className="contacts-empty">
              <span className="contacts-empty__icon" aria-hidden="true">◎</span>
              <h2>Контакты отсутствуют. Добавьте первый контакт</h2>
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
                        indeterminate={selectedContacts.length > 0 && !areAllContactsSelected}
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
                    <ContactRow
                      key={contact.id}
                      contact={contact}
                      selected={selectedIds.has(contact.id)}
                      menuOpen={openMenuId === contact.id}
                      onToggleSelected={() => toggleContact(contact.id)}
                      onOpen={() => setDialog({
                        mode: 'view',
                        contactId: contact.id,
                        contactName: contact.name,
                      })}
                      onEdit={() => {
                        setOpenMenuId('')
                        setDialog({
                          mode: 'edit',
                          contactId: contact.id,
                          contactName: contact.name,
                        })
                      }}
                      onDelete={() => openDeleteConfirmation({ kind: 'single', contact })}
                      onToggleMenu={() => setOpenMenuId((current) => current === contact.id ? '' : contact.id)}
                    />
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
              disabled={page <= 1 || state.isLoading}
              onClick={() => changePage(Math.max(1, page - 1))}
            >
              Предыдущая страница
            </button>
            <span>Страница <strong>{page}</strong> из {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages || state.isLoading}
              onClick={() => changePage(Math.min(totalPages, page + 1))}
            >
              Следующая страница
            </button>
          </nav>
        )}
      </section>

      {dialog?.mode === 'create' && (
        <CreateContactModal
          onClose={() => setDialog(null)}
          onCreated={handleContactCreated}
        />
      )}

      {dialog && dialog.mode !== 'create' && (
        <RealtimeContactModal
          contactId={dialog.contactId}
          contactName={dialog.contactName}
          initialMode={dialog.mode}
          onClose={() => setDialog(null)}
          onUpdated={() => reloadContacts()}
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
          onCancel={() => {
            if (isDeleting) return
            setDeleteRequest(null)
            setDeleteError('')
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {toast && (
        <div className="contacts-toast" role="status">
          <span aria-hidden="true">✓</span>
          <p>{toast}</p>
          <button type="button" aria-label="Закрыть уведомление" onClick={() => setToast('')}>×</button>
        </div>
      )}
    </>
  )
}

function ContactRow({
  contact,
  selected,
  menuOpen,
  onToggleSelected,
  onOpen,
  onEdit,
  onDelete,
  onToggleMenu,
}: {
  contact: ApiContact
  selected: boolean
  menuOpen: boolean
  onToggleSelected: () => void
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleMenu: () => void
}) {
  const handleRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (event.target instanceof Element && event.target.closest('button, input, a, [role="menu"]')) return
    onOpen()
  }

  return (
    <tr
      className={`${selected ? 'is-selected ' : ''}contacts-contract-row`}
      data-contact-row-contract="1"
      onClick={handleRowClick}
    >
      <td className="contacts-table__select-cell">
        <input
          type="checkbox"
          aria-label={`Выбрать контакт ${contact.name}`}
          checked={selected}
          onChange={onToggleSelected}
        />
      </td>
      <td>
        <button
          className="contacts-table__name-button"
          type="button"
          title={contact.company || contact.name}
          onClick={onOpen}
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
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="contacts-row-menu__popup" role="menu">
              <button type="button" role="menuitem" onClick={onEdit}>Редактировать</button>
              <button className="contacts-row-menu__danger" type="button" role="menuitem" onClick={onDelete}>
                Удалить
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
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
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <span>
      <input
        ref={checkboxRef}
        type="checkbox"
        aria-label="Выделить все контакты на текущей странице"
        checked={checked}
        onChange={onChange}
      />
      <button
        className="contacts-contract-select-all"
        type="button"
        onClick={onChange}
      >
        Выделить все
      </button>
    </span>
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
        <button className="contacts-page__add-button contacts-contract-loading-add" type="button" disabled>
          Добавить контакт
        </button>
      </header>
      <div className="contacts-table-card">
        <div className="contacts-skeleton-table">
          <span className="contacts-skeleton contacts-skeleton--head" />
          {Array.from({ length: 5 }, (_, index) => (
            <span className="contacts-skeleton contacts-skeleton--row" key={index} />
          ))}
        </div>
      </div>
      <nav className="contacts-pagination contacts-contract-loading-pagination" aria-label="Пагинация контактов">
        <button type="button" disabled>Предыдущая страница</button>
        <span>Страница 1</span>
        <button type="button" disabled>Следующая страница</button>
      </nav>
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
  const cancelRef = useRef<HTMLButtonElement>(null)
  const count = request.kind === 'single' ? 1 : request.contacts.length
  const message = request.kind === 'single'
    ? 'Вы действительно хотите удалить контакт? Действие невозможно отменить. Все связанные сделки потеряют ссылку на контакт.'
    : `Вы действительно хотите удалить выбранные контакты (${count} шт.)? Действие невозможно отменить. Все связанные сделки потеряют ссылку на контакт.`

  useEffect(() => {
    cancelRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab' || !modalRef.current) return
      const buttons = Array.from(modalRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
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
  }, [isDeleting, onCancel])

  return (
    <div
      className="contact-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onCancel()
      }}
    >
      <div className="contact-confirm" ref={modalRef} role="alertdialog" aria-modal="true">
        <span className="contact-confirm__icon" aria-hidden="true">!</span>
        <h2>{message}</h2>
        {error && <p className="contact-confirm__error" role="alert">{error}</p>}
        <div className="contact-confirm__actions">
          <button
            ref={cancelRef}
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
