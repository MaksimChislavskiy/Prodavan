import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ApiError } from '../../shared/api/apiClient'
import {
  bulkDeleteTasks,
  deleteTask,
  getTasksKanban,
  getTasksPage,
  updateTaskStatus,
  type ApiTask,
  type TaskStatus,
  type TasksKanbanResponse,
} from '../../shared/api/tasksApi'
import { getWorkspaceSettings } from '../../shared/api/workspaceSettingsApi'
import {
  CRM_REALTIME_EVENT,
  CRM_REALTIME_RECONNECTED_EVENT,
} from '../../shared/crmRealtime'
import { formatTaskDueDateForDisplay } from '../../shared/taskDateTime'
import { TaskFormModal } from './TaskFormModal'
import './TasksPage.css'
import './TasksPageUpdatedTz.css'

const taskStatuses: TaskStatus[] = ['new', 'in_progress', 'done']

const taskStatusLabels: Record<TaskStatus, { title: string; shortTitle: string }> = {
  new: { title: 'Новые задачи', shortTitle: 'Новые задачи' },
  in_progress: { title: 'В работе', shortTitle: 'В работе' },
  done: { title: 'Завершенные задачи', shortTitle: 'Завершенные задачи' },
}

type TasksBoardState = {
  data: TasksKanbanResponse | null
  isLoading: boolean
  error: string
}

type TaskDialog =
  | { mode: 'create' }
  | { mode: 'view' | 'edit'; taskId: string; taskTitle: string }

type DeleteRequest =
  | { kind: 'single'; tasks: ApiTask[] }
  | { kind: 'bulk'; tasks: ApiTask[] }

type DraggedTask = {
  task: ApiTask
  sourceStatus: TaskStatus
}

type TouchDragState = DraggedTask & {
  startX: number
  startY: number
  moved: boolean
}

type RealtimePayload = {
  event?: string
}

export function TasksPage() {
  const [state, setState] = useState<TasksBoardState>({
    data: null,
    isLoading: true,
    error: '',
  })
  const [requestVersion, setRequestVersion] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [dialog, setDialog] = useState<TaskDialog | null>(null)
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [openMenuId, setOpenMenuId] = useState('')
  const [toast, setToast] = useState('')
  const [draggedTask, setDraggedTask] = useState<DraggedTask | null>(null)
  const [dropTargetStatus, setDropTargetStatus] = useState<TaskStatus | null>(null)
  const [movingTaskId, setMovingTaskId] = useState('')
  const [loadingMoreStatus, setLoadingMoreStatus] = useState<TaskStatus | null>(null)
  const [workspaceTimezone, setWorkspaceTimezone] = useState('UTC')
  const touchDragRef = useRef<TouchDragState | null>(null)
  const ignoreClickTaskIdRef = useRef('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadBoard() {
      setState((current) => ({ ...current, isLoading: true, error: '' }))
      try {
        const [data, workspaceSettings] = await Promise.all([
          getTasksKanban(50, controller.signal),
          getWorkspaceSettings(controller.signal),
        ])
        setWorkspaceTimezone(workspaceSettings.timezone || 'UTC')
        setState({ data, isLoading: false, error: '' })
        setSelectedIds(new Set())
      } catch (error) {
        if (isAbortError(error)) return
        setState((current) => ({
          ...current,
          isLoading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось загрузить задачи.',
        }))
      }
    }

    void loadBoard()
    return () => controller.abort()
  }, [requestVersion])

  useEffect(() => {
    const handleRealtime = (event: Event) => {
      const payload = (event as CustomEvent<RealtimePayload>).detail
      if (
        payload?.event === 'task_created' ||
        payload?.event === 'task_updated' ||
        payload?.event === 'task_deleted' ||
        payload?.event === 'tasks_bulk_deleted'
      ) {
        setRequestVersion((value) => value + 1)
      }
    }
    const handleReconnect = () => setRequestVersion((value) => value + 1)

    window.addEventListener(CRM_REALTIME_EVENT, handleRealtime as EventListener)
    window.addEventListener(CRM_REALTIME_RECONNECTED_EVENT, handleReconnect)
    return () => {
      window.removeEventListener(CRM_REALTIME_EVENT, handleRealtime as EventListener)
      window.removeEventListener(CRM_REALTIME_RECONNECTED_EVENT, handleReconnect)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeoutId = window.setTimeout(() => setToast(''), 5000)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.tasks-card-menu')
      ) return
      setOpenMenuId('')
    }
    const closeMenuByKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId('')
    }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeMenuByKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeMenuByKeyboard)
    }
  }, [])

  const allTasks = useMemo(
    () =>
      state.data
        ? taskStatuses.flatMap((status) => state.data?.[status].tasks ?? [])
        : [],
    [state.data],
  )

  const selectedTasks = useMemo(
    () => allTasks.filter((task) => selectedIds.has(task.id)),
    [allTasks, selectedIds],
  )

  const reloadBoard = () => setRequestVersion((value) => value + 1)

  const toggleTask = (taskId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const openDeleteConfirmation = (request: DeleteRequest) => {
    setOpenMenuId('')
    setDeleteError('')
    setDeleteRequest(request)
  }

  const closeDeleteConfirmation = () => {
    if (isDeleting) return
    setDeleteRequest(null)
    setDeleteError('')
  }

  const confirmDelete = async () => {
    if (!deleteRequest || isDeleting) return
    setIsDeleting(true)
    setDeleteError('')

    try {
      if (deleteRequest.kind === 'single') {
        await deleteTask(deleteRequest.tasks[0].id)
        setToast('Задача удалена.')
      } else {
        const result = await bulkDeleteTasks(
          deleteRequest.tasks.map((task) => task.id),
        )
        setToast(
          `Удалено задач: ${result.deleted_count}. Пропущено: ${result.skipped_ids.length}.`,
        )
      }
      setDeleteRequest(null)
      setDialog(null)
      reloadBoard()
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : 'Не удалось удалить задачи. Попробуйте позже.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  const loadMore = async (status: TaskStatus) => {
    const column = state.data?.[status]
    if (!column?.next_cursor || loadingMoreStatus) return

    setLoadingMoreStatus(status)
    try {
      const response = await getTasksPage(status, 50, column.next_cursor)
      setState((current) => {
        if (!current.data) return current
        const currentTasks = current.data[status].tasks
        const knownIds = new Set(currentTasks.map((task) => task.id))
        return {
          ...current,
          data: {
            ...current.data,
            [status]: {
              ...current.data[status],
              tasks: [
                ...currentTasks,
                ...response.tasks.filter((task) => !knownIds.has(task.id)),
              ],
              next_cursor: response.has_more ? response.next_cursor : null,
            },
          },
        }
      })
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить следующие задачи.',
      )
    } finally {
      setLoadingMoreStatus(null)
    }
  }

  const moveTask = async (
    task: ApiTask,
    sourceStatus: TaskStatus,
    targetStatus: TaskStatus,
  ) => {
    if (sourceStatus === targetStatus || movingTaskId) return
    setMovingTaskId(task.id)
    try {
      await updateTaskStatus(task.id, targetStatus, task.version)
      setToast(`Задача перенесена в колонку «${taskStatusLabels[targetStatus].shortTitle}».`)
      reloadBoard()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setToast('Задача была изменена другим пользователем. Обновите данные.')
      } else if (error instanceof ApiError && error.status === 404) {
        setToast('Задача не найдена или уже удалена.')
      } else {
        setToast(
          error instanceof Error
            ? error.message
            : 'Не удалось изменить статус задачи.',
        )
      }
      reloadBoard()
    } finally {
      setMovingTaskId('')
    }
  }

  const handleDragStart = (
    event: DragEvent<HTMLElement>,
    task: ApiTask,
    sourceStatus: TaskStatus,
  ) => {
    if (movingTaskId) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task.id)
    setDraggedTask({ task, sourceStatus })
    setDropTargetStatus(null)
    setOpenMenuId('')
  }

  const handleDragEnd = () => {
    setDraggedTask(null)
    setDropTargetStatus(null)
  }

  const handleColumnDragOver = (
    event: DragEvent<HTMLElement>,
    status: TaskStatus,
  ) => {
    if (!draggedTask || movingTaskId || draggedTask.sourceStatus === status) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetStatus(status)
  }

  const handleColumnDrop = (
    event: DragEvent<HTMLElement>,
    status: TaskStatus,
  ) => {
    event.preventDefault()
    const current = draggedTask
    setDraggedTask(null)
    setDropTargetStatus(null)
    if (current) void moveTask(current.task, current.sourceStatus, status)
  }

  const handleTouchPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    task: ApiTask,
    sourceStatus: TaskStatus,
  ) => {
    if (event.pointerType !== 'touch' || movingTaskId) return
    touchDragRef.current = {
      task,
      sourceStatus,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
  }

  const handleTouchPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = touchDragRef.current
    if (!current || event.pointerType !== 'touch') return
    const distance = Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    )
    if (!current.moved && distance < 10) return
    current.moved = true
    event.preventDefault()
    setDraggedTask({ task: current.task, sourceStatus: current.sourceStatus })

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-task-status]')
    const nextStatus = target?.dataset.taskStatus as TaskStatus | undefined
    if (
      nextStatus &&
      taskStatuses.includes(nextStatus) &&
      nextStatus !== current.sourceStatus
    ) {
      setDropTargetStatus(nextStatus)
    } else {
      setDropTargetStatus(null)
    }
  }

  const handleTouchPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const current = touchDragRef.current
    if (!current || event.pointerType !== 'touch') return
    const targetStatus = dropTargetStatus
    touchDragRef.current = null
    setDraggedTask(null)
    setDropTargetStatus(null)

    if (current.moved) {
      ignoreClickTaskIdRef.current = current.task.id
      window.setTimeout(() => {
        if (ignoreClickTaskIdRef.current === current.task.id) {
          ignoreClickTaskIdRef.current = ''
        }
      }, 350)
      if (targetStatus && targetStatus !== current.sourceStatus) {
        void moveTask(current.task, current.sourceStatus, targetStatus)
      }
    }
  }

  const handleTaskSaved = (message: string) => {
    setDialog(null)
    setToast(message)
    reloadBoard()
  }

  const handleTaskNotFound = () => {
    setDialog(null)
    setToast('Задача не найдена или уже удалена.')
    reloadBoard()
  }

  if (state.isLoading && !state.data) return <TasksSkeleton />

  if (state.error || !state.data) {
    return (
      <section className="tasks-state-card" aria-live="polite">
        <h1>Не удалось загрузить задачи</h1>
        <p>{state.error || 'Попробуйте повторить запрос.'}</p>
        <button type="button" onClick={reloadBoard}>Повторить</button>
      </section>
    )
  }

  const board = state.data

  return (
    <>
      <section className="tasks-page" aria-label="Задачи">
        <div className="tasks-page__utility-row">
          {selectedTasks.length > 0 ? (
            <div className="tasks-bulk-panel" aria-live="polite">
              <span>
                <span aria-hidden="true">⌫</span>
                Выбрано: {selectedTasks.length}
              </span>
              <button
                type="button"
                disabled={selectedTasks.length > 100}
                title={
                  selectedTasks.length > 100
                    ? 'Можно удалить не более 100 задач за раз'
                    : undefined
                }
                onClick={() =>
                  openDeleteConfirmation({ kind: 'bulk', tasks: selectedTasks })
                }
              >
                Удалить выбранные
              </button>
            </div>
          ) : (
            <p className="tasks-page__selection-hint">
              <span aria-hidden="true">⌑</span>
              Выберите задачи для массовых действий
            </p>
          )}
        </div>

        {state.isLoading && (
          <div className="tasks-page__refreshing" role="status">
            Обновляем задачи…
          </div>
        )}

        <div className="tasks-board" aria-label="Канбан задач">
          {taskStatuses.map((status) => {
            const column = board[status]
            const isDropTarget = dropTargetStatus === status

            return (
              <article
                className={[
                  'tasks-column',
                  `tasks-column--${status}`,
                  isDropTarget ? 'tasks-column--drop-target' : '',
                ].filter(Boolean).join(' ')}
                key={status}
                data-task-status={status}
                onDragOver={(event) => handleColumnDragOver(event, status)}
                onDrop={(event) => handleColumnDrop(event, status)}
              >
                <header className="tasks-column__header">
                  <div>
                    <h2>{taskStatusLabels[status].title}</h2>
                    <span>{column.count}</span>
                  </div>
                  {status === 'new' && (
                    <button
                      type="button"
                      aria-label="Создать задачу"
                      title="Создать задачу"
                      onClick={() => setDialog({ mode: 'create' })}
                    >
                      +
                    </button>
                  )}
                </header>

                <div className="tasks-column__cards">
                  {column.tasks.map((task) => (
                    <TaskCard
                      task={task}
                      workspaceTimezone={workspaceTimezone}
                      isSelected={selectedIds.has(task.id)}
                      isMoving={movingTaskId === task.id}
                      isMenuOpen={openMenuId === task.id}
                      key={task.id}
                      onSelect={() => toggleTask(task.id)}
                      onOpen={() => {
                        if (ignoreClickTaskIdRef.current === task.id) return
                        setDialog({
                          mode: 'view',
                          taskId: task.id,
                          taskTitle: task.title,
                        })
                      }}
                      onEdit={() => {
                        setOpenMenuId('')
                        setDialog({
                          mode: 'edit',
                          taskId: task.id,
                          taskTitle: task.title,
                        })
                      }}
                      onDelete={() =>
                        openDeleteConfirmation({ kind: 'single', tasks: [task] })
                      }
                      onToggleMenu={() =>
                        setOpenMenuId((current) => current === task.id ? '' : task.id)
                      }
                      onDragStart={(event) => handleDragStart(event, task, status)}
                      onDragEnd={handleDragEnd}
                      onPointerDown={(event) => handleTouchPointerDown(event, task, status)}
                      onPointerMove={handleTouchPointerMove}
                      onPointerEnd={handleTouchPointerEnd}
                    />
                  ))}

                  {column.next_cursor && (
                    <button
                      className="tasks-column__load-more"
                      type="button"
                      disabled={loadingMoreStatus !== null}
                      onClick={() => void loadMore(status)}
                    >
                      {loadingMoreStatus === status
                        ? 'Загрузка…'
                        : `Показать ещё (${Math.max(0, column.count - column.tasks.length)})`}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {dialog?.mode === 'create' && (
        <TaskFormModal
          mode="create"
          onClose={() => setDialog(null)}
          onCreated={() => handleTaskSaved('Задача создана.')}
          onUpdated={() => handleTaskSaved('Задача обновлена.')}
          onDeleted={() => handleTaskSaved('Задача удалена.')}
          onNotFound={handleTaskNotFound}
        />
      )}

      {(dialog?.mode === 'view' || dialog?.mode === 'edit') && (
        <TaskFormModal
          mode={dialog.mode}
          taskId={dialog.taskId}
          taskTitle={dialog.taskTitle}
          onClose={() => setDialog(null)}
          onCreated={() => handleTaskSaved('Задача создана.')}
          onUpdated={() => handleTaskSaved('Задача обновлена.')}
          onDeleted={() => handleTaskSaved('Задача удалена.')}
          onNotFound={handleTaskNotFound}
        />
      )}

      {deleteRequest && (
        <TaskDeleteConfirmModal
          request={deleteRequest}
          isDeleting={isDeleting}
          error={deleteError}
          onCancel={closeDeleteConfirmation}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {toast && (
        <div className="tasks-toast" role="status">
          <span aria-hidden="true">✓</span>
          <p>{toast}</p>
          <button
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

function TaskCard({
  task,
  workspaceTimezone,
  isSelected,
  isMoving,
  isMenuOpen,
  onSelect,
  onOpen,
  onEdit,
  onDelete,
  onToggleMenu,
  onDragStart,
  onDragEnd,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
}: {
  task: ApiTask
  workspaceTimezone: string
  isSelected: boolean
  isMoving: boolean
  isMenuOpen: boolean
  onSelect: () => void
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleMenu: () => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerEnd: (event: ReactPointerEvent<HTMLElement>) => void
}) {
  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest('button, input, a')
    ) return
    onOpen()
  }

  const amount = formatTaskAmount(task)
  const contactName = getTaskContactName(task)
  const overdue = task.is_overdue && task.status !== 'done'

  return (
    <article
      className={[
        'tasks-card',
        `tasks-card--${task.status}`,
        overdue ? 'tasks-card--overdue' : '',
        isSelected ? 'tasks-card--selected' : '',
        isMoving ? 'tasks-card--moving' : '',
      ].filter(Boolean).join(' ')}
      draggable={!isMoving}
      aria-label={`${task.title}. ${taskStatusLabels[task.status].shortTitle}`}
      onClick={handleCardClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <input
        className="tasks-card__checkbox"
        type="checkbox"
        checked={isSelected}
        aria-label={`Выбрать задачу ${task.title}`}
        onChange={onSelect}
      />

      <div className="tasks-card__content">
        <div className="tasks-card__heading">
          <div>
            <h3 title={task.title}>{task.title}</h3>
            {task.created_by_ai && <span className="tasks-card__ai-badge">AI</span>}
          </div>

          <div className="tasks-card-menu">
            <button
              className="tasks-card-menu__trigger"
              type="button"
              aria-label={`Действия с задачей ${task.title}`}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              onClick={onToggleMenu}
            >
              ⋮
            </button>

            {isMenuOpen && (
              <div
                className="tasks-card-menu__popup"
                role="menu"
                aria-label={`Действия с задачей ${task.title}`}
              >
                <button type="button" role="menuitem" onClick={onEdit}>
                  Редактировать
                </button>
                <button
                  className="tasks-card-menu__danger"
                  type="button"
                  role="menuitem"
                  onClick={onDelete}
                >
                  Удалить
                </button>
              </div>
            )}
          </div>
        </div>

        {task.contact?.id ? (
          <a
            className="tasks-card__contact"
            href={`/app/contacts?contact_id=${encodeURIComponent(task.contact.id)}`}
            title={contactName}
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            {contactName}
          </a>
        ) : (
          <p className="tasks-card__contact" title={contactName}>{contactName}</p>
        )}

        <div className="tasks-card__meta">
          <span className={overdue ? 'is-overdue' : ''}>
            {formatTaskDueDateForDisplay(task, workspaceTimezone)}
          </span>

          {task.deal && (
            <span title={task.deal.title}>
              Связанный объект:{' '}
              <a
                href={`/app/deals?deal_id=${encodeURIComponent(task.deal.id)}`}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                Сделка «{task.deal.title}»
              </a>
            </span>
          )}

          {amount && <strong>{amount}</strong>}
          {overdue && <strong className="tasks-card__overdue-text">Просрочено</strong>}
        </div>
      </div>
    </article>
  )
}

function TaskDeleteConfirmModal({
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
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const count = request.tasks.length

  useEffect(() => {
    cancelButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) {
        event.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isDeleting, onCancel])

  return (
    <div className="tasks-delete-overlay" role="presentation">
      <div
        className="tasks-delete-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tasks-delete-title"
        aria-describedby="tasks-delete-text"
      >
        <span className="tasks-delete-modal__icon" aria-hidden="true">!</span>
        <h2 id="tasks-delete-title">
          {request.kind === 'single'
            ? 'Удалить задачу?'
            : `Удалить выбранные задачи (${count})?`}
        </h2>
        <p id="tasks-delete-text">
          {request.kind === 'single'
            ? `Задача «${request.tasks[0].title}» исчезнет из канбана.`
            : 'Все выбранные задачи исчезнут из канбана.'}{' '}
          Действие невозможно отменить.
        </p>
        {error && <p className="tasks-delete-modal__error">{error}</p>}
        <div className="tasks-delete-modal__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={isDeleting}
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            className="is-danger"
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

function TasksSkeleton() {
  return (
    <section
      className="tasks-page tasks-page--loading"
      aria-label="Загружаем задачи"
      aria-busy="true"
    >
      <div className="tasks-page__utility-row">
        <span className="tasks-skeleton tasks-skeleton--hint" />
      </div>
      <div className="tasks-board">
        {taskStatuses.map((status) => (
          <article className="tasks-column" key={status}>
            <span className="tasks-skeleton tasks-skeleton--header" />
            {Array.from({ length: 3 }, (_, index) => (
              <span className="tasks-skeleton tasks-skeleton--card" key={index} />
            ))}
          </article>
        ))}
      </div>
    </section>
  )
}

function getTaskContactName(task: ApiTask) {
  if (!task.contact) return 'Не указан'
  return task.contact.company || task.contact.name
}

function formatTaskAmount(task: ApiTask) {
  if (!task.deal || task.deal.amount == null) return ''
  const amount = Number(task.deal.amount)
  if (!Number.isFinite(amount)) return `${task.deal.amount} ${task.deal.currency}`
  const formattedAmount = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount)
  const currencySymbols: Record<string, string> = {
    RUB: '₽',
    USD: '$',
    EUR: '€',
  }
  return `${formattedAmount} ${currencySymbols[task.deal.currency] ?? task.deal.currency}`
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
