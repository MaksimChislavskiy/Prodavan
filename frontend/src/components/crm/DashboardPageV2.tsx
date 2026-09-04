import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import {
  deleteTask,
  getTasksDashboard,
  type ApiDashboardTask,
  type ApiTask,
} from '../../shared/api/tasksApi'
import { getWorkspaceSettings } from '../../shared/api/workspaceSettingsApi'
import { ContactFormModal } from './ContactFormModal'
import { ContactViewModal } from './ContactViewModal'
import { TaskFormModal } from './TaskFormModal'
import { TaskViewModal } from './TaskViewModal'
import { ViewDealModal } from './ViewDealModal'
import './DashboardPage.css'
import './DashboardPageContract.css'

type DashboardState = {
  tasks: ApiDashboardTask[]
  totalCount: number
  isLoading: boolean
  hasLoaded: boolean
  hasError: boolean
}

type DashboardDialog =
  | { mode: 'view'; task: ApiDashboardTask }
  | { mode: 'edit'; task: ApiDashboardTask }

type RelatedDialog =
  | { kind: 'contact-view'; id: string; name: string }
  | { kind: 'contact-edit'; id: string; name: string }
  | { kind: 'deal-view'; id: string; name: string }

const DASHBOARD_LOAD_ERROR = 'Не удалось загрузить задачи. Обновите страницу.'
const DASHBOARD_DELETE_ERROR = 'Не удалось удалить задачу. Попробуйте позже.'

export function DashboardPage({ onShowAll }: { onShowAll: () => void }) {
  const [state, setState] = useState<DashboardState>({
    tasks: [],
    totalCount: 0,
    isLoading: true,
    hasLoaded: false,
    hasError: false,
  })
  const [dialog, setDialog] = useState<DashboardDialog | null>(null)
  const [relatedDialog, setRelatedDialog] = useState<RelatedDialog | null>(null)
  const [openMenuId, setOpenMenuId] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ApiDashboardTask | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [toast, setToast] = useState('')
  const [workspaceTimezone, setWorkspaceTimezone] = useState('UTC')
  const [isHintOpen, setIsHintOpen] = useState(false)

  const dashboardControllerRef = useRef<AbortController | null>(null)
  const deleteControllerRef = useRef<AbortController | null>(null)
  const hintRef = useRef<HTMLSpanElement>(null)

  const loadDashboard = useCallback(async (initial = false) => {
    dashboardControllerRef.current?.abort()
    const controller = new AbortController()
    dashboardControllerRef.current = controller

    setState((current) => ({
      ...current,
      isLoading: true,
      hasLoaded: initial ? false : current.hasLoaded,
      hasError: false,
    }))

    try {
      const [dashboard, settings] = await Promise.all([
        getTasksDashboard(controller.signal),
        getWorkspaceSettings(controller.signal),
      ])

      if (controller.signal.aborted) {
        return
      }

      setWorkspaceTimezone(settings.timezone || 'UTC')
      setState({
        tasks: dashboard.tasks,
        totalCount: dashboard.total_count,
        isLoading: false,
        hasLoaded: true,
        hasError: false,
      })
      setToast((current) => current === DASHBOARD_LOAD_ERROR ? '' : current)
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      setState((current) => ({
        ...current,
        isLoading: false,
        hasLoaded: true,
        hasError: true,
      }))
      setToast(DASHBOARD_LOAD_ERROR)
    } finally {
      if (dashboardControllerRef.current === controller) {
        dashboardControllerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    void loadDashboard(true)

    return () => {
      dashboardControllerRef.current?.abort()
      deleteControllerRef.current?.abort()
    }
  }, [loadDashboard])

  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      if (
        isHintOpen
        && hintRef.current
        && event.target instanceof Node
        && !hintRef.current.contains(event.target)
      ) {
        setIsHintOpen(false)
      }

      if (
        event.target instanceof Element
        && event.target.closest('.dashboard-task-menu')
      ) {
        return
      }
      setOpenMenuId('')
    }

    document.addEventListener('pointerdown', handleOutsidePointer)
    return () => document.removeEventListener('pointerdown', handleOutsidePointer)
  }, [isHintOpen])

  useEffect(() => {
    if (!toast || toast === DASHBOARD_LOAD_ERROR) {
      return
    }

    const timeoutId = window.setTimeout(() => setToast(''), 5000)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  const refreshDashboard = () => {
    setDialog(null)
    setOpenMenuId('')
    void loadDashboard(false)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || isDeleting) {
      return
    }

    deleteControllerRef.current?.abort()
    const controller = new AbortController()
    deleteControllerRef.current = controller
    setIsDeleting(true)

    try {
      await deleteTask(deleteTarget.id, controller.signal)
      if (controller.signal.aborted) {
        return
      }

      setDeleteTarget(null)
      await loadDashboard(false)
    } catch (error) {
      if (!isAbortError(error)) {
        setDeleteTarget(null)
        setToast(DASHBOARD_DELETE_ERROR)
      }
    } finally {
      if (deleteControllerRef.current === controller) {
        deleteControllerRef.current = null
      }
      setIsDeleting(false)
    }
  }

  const toggleHint = () => {
    if (typeof window === 'undefined') {
      return
    }

    if (window.matchMedia('(hover: none)').matches) {
      setIsHintOpen((current) => !current)
    }
  }

  return (
    <>
      <main className="dashboard-page">
        <section
          className="dashboard-today"
          aria-labelledby="dashboard-today-title"
          aria-busy={state.isLoading}
        >
          <header className="dashboard-today__header">
            <div className="dashboard-today__heading">
              <h2 id="dashboard-today-title">Важное на сегодня</h2>
              <span
                className={`dashboard-hint${isHintOpen ? ' dashboard-hint--open' : ''}`}
                ref={hintRef}
              >
                <button
                  type="button"
                  aria-label="Подсказка о задачах на сегодня"
                  aria-controls="dashboard-today-tooltip"
                  aria-expanded={isHintOpen}
                  onClick={toggleHint}
                >
                  ⓘ
                </button>
                <span id="dashboard-today-tooltip" role="tooltip">
                  План на сегодня: приоритеты и дедлайны
                </span>
              </span>
            </div>

            {state.totalCount > 10 && (
              <button
                className="dashboard-today__show-all"
                type="button"
                onClick={onShowAll}
              >
                Показать все
              </button>
            )}
          </header>

          {state.isLoading && !state.hasLoaded && <DashboardSkeleton />}

          {state.hasLoaded
            && !state.isLoading
            && !state.hasError
            && state.tasks.length === 0
            && state.totalCount === 0
            && (
              <div className="dashboard-state dashboard-state--empty">
                <span aria-hidden="true">✓</span>
                <strong>На сегодня задач нет. Отличная работа!</strong>
              </div>
            )}

          {state.hasLoaded && state.tasks.length > 0 && (
            <div className="dashboard-task-grid">
              {state.tasks.map((task) => (
                <DashboardTaskCard
                  key={task.id}
                  task={task}
                  timezone={workspaceTimezone}
                  isMenuOpen={openMenuId === task.id}
                  onOpen={() => setDialog({ mode: 'view', task })}
                  onOpenContact={() => {
                    if (!task.contact?.id) return
                    setRelatedDialog({
                      kind: 'contact-view',
                      id: task.contact.id,
                      name: getTaskClientName(task),
                    })
                  }}
                  onOpenDeal={() => {
                    if (!task.deal?.id) return
                    setRelatedDialog({
                      kind: 'deal-view',
                      id: task.deal.id,
                      name: task.deal.title,
                    })
                  }}
                  onEdit={() => {
                    setOpenMenuId('')
                    setDialog({ mode: 'edit', task })
                  }}
                  onDelete={() => {
                    setOpenMenuId('')
                    setDeleteTarget(task)
                  }}
                  onToggleMenu={() =>
                    setOpenMenuId((currentId) =>
                      currentId === task.id ? '' : task.id,
                    )
                  }
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {dialog?.mode === 'view' && (
        <TaskViewModal
          taskId={dialog.task.id}
          taskTitle={dialog.task.title}
          onClose={() => setDialog(null)}
          onEdit={(task) => setDialog({ mode: 'edit', task })}
          onDelete={(task) => {
            setDialog(null)
            setDeleteTarget(task)
          }}
          onNotFound={refreshDashboard}
        />
      )}

      {dialog?.mode === 'edit' && (
        <TaskFormModal
          mode="edit"
          taskId={dialog.task.id}
          taskTitle={dialog.task.title}
          onClose={() => setDialog(null)}
          onCreated={refreshDashboard}
          onUpdated={refreshDashboard}
          onDeleted={refreshDashboard}
          onNotFound={refreshDashboard}
        />
      )}

      {relatedDialog?.kind === 'contact-view' && (
        <ContactViewModal
          contactId={relatedDialog.id}
          contactName={relatedDialog.name}
          onClose={() => setRelatedDialog(null)}
          onEdit={(contact) =>
            setRelatedDialog({
              kind: 'contact-edit',
              id: contact.id,
              name: contact.name,
            })
          }
          onNotFound={() => setRelatedDialog(null)}
          onOpenRelatedDeals={(contact) => {
            const params = new URLSearchParams({
              contact_id: contact.id,
              contact_name: contact.name,
            })
            window.location.assign(`/app/deals?${params.toString()}`)
          }}
        />
      )}

      {relatedDialog?.kind === 'contact-edit' && (
        <ContactFormModal
          mode="edit"
          contactId={relatedDialog.id}
          contactName={relatedDialog.name}
          onClose={() => setRelatedDialog(null)}
          onCreated={() => setRelatedDialog(null)}
          onUpdated={() => setRelatedDialog(null)}
          onNotFound={() => setRelatedDialog(null)}
        />
      )}

      {relatedDialog?.kind === 'deal-view' && (
        <ViewDealModal
          dealId={relatedDialog.id}
          dealName={relatedDialog.name}
          onClose={() => setRelatedDialog(null)}
        />
      )}

      {deleteTarget && (
        <div className="dashboard-delete-overlay" role="presentation">
          <div
            className="dashboard-delete-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="dashboard-delete-title"
            aria-describedby="dashboard-delete-description"
          >
            <h2 id="dashboard-delete-title">Удалить задачу?</h2>
            <p id="dashboard-delete-description">
              Вы действительно хотите удалить задачу? Действие невозможно отменить.
            </p>
            <div>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void confirmDelete()}
              >
                {isDeleting ? 'Удаление…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="dashboard-toast" role="alert">
          <span>{toast}</span>
          {toast === DASHBOARD_LOAD_ERROR && (
            <button type="button" onClick={() => void loadDashboard(false)}>
              Повторить
            </button>
          )}
          <button
            className="dashboard-toast__close"
            type="button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast('')}
          >
            ×
          </button>
        </div>
      )}
    </>
  )
}

function DashboardTaskCard({
  task,
  timezone,
  isMenuOpen,
  onOpen,
  onOpenContact,
  onOpenDeal,
  onEdit,
  onDelete,
  onToggleMenu,
}: {
  task: ApiDashboardTask
  timezone: string
  isMenuOpen: boolean
  onOpen: () => void
  onOpenContact: () => void
  onOpenDeal: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleMenu: () => void
}) {
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (
      event.target instanceof Element
      && event.target.closest('button, a')
    ) {
      return
    }
    onOpen()
  }

  const contactName = getTaskClientName(task)
  const amount = getTaskAmount(task)

  return (
    <article className="dashboard-task-card" onClick={handleClick}>
      <div className="dashboard-task-card__top">
        <h3 title={task.title}>{task.title}</h3>
        <div className="dashboard-task-menu">
          <button
            type="button"
            aria-label={`Действия с задачей ${task.title}`}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={onToggleMenu}
          >
            ⋮
          </button>
          {isMenuOpen && (
            <div className="dashboard-task-menu__popup" role="menu">
              <button type="button" role="menuitem" onClick={onEdit}>
                Редактировать
              </button>
              <button type="button" role="menuitem" onClick={onDelete}>
                Удалить
              </button>
            </div>
          )}
        </div>
      </div>

      <dl>
        <div>
          <dt>Клиент:</dt>
          <dd>
            {task.contact?.id ? (
              <a
                href={`/app/contacts?contact_id=${encodeURIComponent(task.contact.id)}`}
                onClick={(event) => {
                  event.preventDefault()
                  onOpenContact()
                }}
              >
                {contactName}
              </a>
            ) : (
              contactName
            )}
          </dd>
        </div>

        {amount && (
          <div>
            <dt>Сумма:</dt>
            <dd>{amount}</dd>
          </div>
        )}

        <div>
          <dt>Дедлайн:</dt>
          <dd>{getTaskDueText(task, timezone)}</dd>
        </div>

        {task.deal && (
          <div>
            <dt>Сделка:</dt>
            <dd>
              <a
                href={`/app/deals?deal_id=${encodeURIComponent(task.deal.id)}`}
                onClick={(event) => {
                  event.preventDefault()
                  onOpenDeal()
                }}
              >
                {task.deal.title}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {task.is_overdue && task.status !== 'done' && (
        <span className="dashboard-task-card__overdue">просрочено</span>
      )}
    </article>
  )
}

function DashboardSkeleton() {
  return (
    <div
      className="dashboard-task-grid"
      aria-label="Загрузка задач"
      aria-busy="true"
    >
      {[0, 1, 2, 3, 4].map((item) => (
        <span className="dashboard-skeleton" key={item} />
      ))}
    </div>
  )
}

function getTaskClientName(task: ApiTask) {
  if (!task.contact) {
    return 'Не указан'
  }

  return task.contact.company || task.contact.name || 'Не указан'
}

function getTaskAmount(task: ApiTask) {
  if (!task.deal || task.deal.amount === null) {
    return ''
  }

  const amount = Number(task.deal.amount)
  if (!Number.isFinite(amount)) {
    return `${task.deal.amount} ${task.deal.currency || 'RUB'}`
  }

  const currency = task.deal.currency || 'RUB'
  const symbol =
    currency === 'RUB'
      ? '₽'
      : currency === 'USD'
        ? '$'
        : currency === 'EUR'
          ? '€'
          : currency

  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount)} ${symbol}`
}

function getTaskDueText(task: ApiTask, timezone: string) {
  if (!task.due_date || task.due_date_type === 'none') {
    return 'Без срока'
  }

  const dueDate = new Date(task.due_date)
  if (Number.isNaN(dueDate.getTime())) {
    return 'Срок указан'
  }

  const safeTimezone = isSupportedTimezone(timezone) ? timezone : 'UTC'
  const todayKey = dateKey(new Date(), safeTimezone)
  const dueKey = dateKey(dueDate, safeTimezone)
  const isToday = todayKey === dueKey

  if (task.due_date_type === 'date') {
    if (isToday) {
      return 'сегодня'
    }

    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: safeTimezone,
    }).format(dueDate)
  }

  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: safeTimezone,
  }).format(dueDate)

  if (isToday) {
    return `сегодня, ${time}`
  }

  const date = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: safeTimezone,
  }).format(dueDate)

  return `${date}, ${time}`
}

function dateKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).format(date)
}

function isSupportedTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
