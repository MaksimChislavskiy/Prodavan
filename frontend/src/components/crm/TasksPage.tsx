import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react'
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
import { TaskFormModal } from './TaskFormModal'
import { TaskViewModal } from './TaskViewModal'
import './TasksPage.css'

const taskStatuses: TaskStatus[] = ['new', 'in_progress', 'done']

const taskStatusLabels: Record<
  TaskStatus,
  { title: string; shortTitle: string }
> = {
  new: {
    title: 'Новые задачи',
    shortTitle: 'Новая',
  },
  in_progress: {
    title: 'В работе',
    shortTitle: 'В работе',
  },
  done: {
    title: 'Завершённые задачи',
    shortTitle: 'Выполнена',
  },
}

type TasksBoardState = {
  data: TasksKanbanResponse | null
  isLoading: boolean
  error: string
}

type TaskDialog =
  | { mode: 'create' }
  | { mode: 'view'; taskId: string; taskTitle: string }
  | { mode: 'edit'; taskId: string; taskTitle: string }

type DeleteRequest =
  | { kind: 'single'; tasks: ApiTask[] }
  | { kind: 'bulk'; tasks: ApiTask[] }

type DraggedTask = {
  task: ApiTask
  sourceStatus: TaskStatus
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
  const [loadingMoreStatus, setLoadingMoreStatus] =
    useState<TaskStatus | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadBoard() {
      setState((currentState) => ({
        ...currentState,
        isLoading: true,
        error: '',
      }))

      try {
        const data = await getTasksKanban(50, controller.signal)

        setState({
          data,
          isLoading: false,
          error: '',
        })
        setSelectedIds(new Set())
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        setState((currentState) => ({
          ...currentState,
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
    if (!toast) {
      return
    }

    const timeoutId = window.setTimeout(() => setToast(''), 5000)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.tasks-card-menu')
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

  const reloadBoard = () => {
    setRequestVersion((currentVersion) => currentVersion + 1)
  }

  const toggleTask = (taskId: string) => {
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds)

      if (nextIds.has(taskId)) {
        nextIds.delete(taskId)
      } else {
        nextIds.add(taskId)
      }

      return nextIds
    })
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
        await deleteTask(deleteRequest.tasks[0].id)
        setToast('Задача удалена.')
      } else {
        const result = await bulkDeleteTasks(
          deleteRequest.tasks.map((task) => task.id),
        )
        setToast(
          result.deleted_count === 1
            ? 'Удалена 1 задача.'
            : `Удалено задач: ${result.deleted_count}.`,
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

    if (!column?.next_cursor || loadingMoreStatus) {
      return
    }

    setLoadingMoreStatus(status)

    try {
      const response = await getTasksPage(status, 50, column.next_cursor)

      setState((currentState) => {
        if (!currentState.data) {
          return currentState
        }

        const currentTasks = currentState.data[status].tasks
        const knownIds = new Set(currentTasks.map((task) => task.id))

        return {
          ...currentState,
          data: {
            ...currentState.data,
            [status]: {
              ...currentState.data[status],
              tasks: [
                ...currentTasks,
                ...response.tasks.filter((task) => !knownIds.has(task.id)),
              ],
              next_cursor: response.has_more
                ? response.next_cursor
                : null,
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
    if (
      !draggedTask ||
      movingTaskId ||
      draggedTask.sourceStatus === status
    ) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetStatus(status)
  }

  const handleColumnDragLeave = (
    event: DragEvent<HTMLElement>,
    status: TaskStatus,
  ) => {
    const relatedTarget = event.relatedTarget

    if (
      dropTargetStatus === status &&
      (!(relatedTarget instanceof Node) ||
        !event.currentTarget.contains(relatedTarget))
    ) {
      setDropTargetStatus(null)
    }
  }

  const handleColumnDrop = (
    event: DragEvent<HTMLElement>,
    status: TaskStatus,
  ) => {
    event.preventDefault()
    void moveTask(status)
  }

  const moveTask = async (status: TaskStatus) => {
    const currentDraggedTask = draggedTask

    setDraggedTask(null)
    setDropTargetStatus(null)

    if (
      !currentDraggedTask ||
      currentDraggedTask.sourceStatus === status ||
      movingTaskId
    ) {
      return
    }

    setMovingTaskId(currentDraggedTask.task.id)

    try {
      await updateTaskStatus(
        currentDraggedTask.task.id,
        status,
        currentDraggedTask.task.version,
      )
      setToast(
        `Задача перенесена в колонку «${taskStatusLabels[status].shortTitle}».`,
      )
      reloadBoard()
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : 'Не удалось изменить статус задачи.',
      )
      reloadBoard()
    } finally {
      setMovingTaskId('')
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

  if (state.isLoading && !state.data) {
    return <TasksSkeleton />
  }

  if (state.error || !state.data) {
    return (
      <section className="tasks-state-card" aria-live="polite">
        <h1>Не удалось загрузить задачи</h1>
        <p>{state.error || 'Попробуйте повторить запрос.'}</p>
        <button type="button" onClick={reloadBoard}>
          Повторить
        </button>
      </section>
    )
  }

  const board = state.data

  return (
    <>
      <section className="tasks-page" aria-label="Задачи">
        <div className="tasks-page__utility-row">
          <div>
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
                    openDeleteConfirmation({
                      kind: 'bulk',
                      tasks: selectedTasks,
                    })
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

          <button
            className="tasks-page__create-button"
            type="button"
            onClick={() => setDialog({ mode: 'create' })}
          >
            <span aria-hidden="true">+</span>
            Создать задачу
          </button>
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
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={status}
                onDragOver={(event) => handleColumnDragOver(event, status)}
                onDragLeave={(event) => handleColumnDragLeave(event, status)}
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
                  {column.tasks.length === 0 ? (
                    <div className="tasks-column__empty">
                      <span aria-hidden="true">✓</span>
                      <p>Нет задач</p>
                    </div>
                  ) : (
                    column.tasks.map((task) => (
                      <TaskCard
                        task={task}
                        isSelected={selectedIds.has(task.id)}
                        isMoving={movingTaskId === task.id}
                        isMenuOpen={openMenuId === task.id}
                        key={task.id}
                        onSelect={() => toggleTask(task.id)}
                        onOpen={() =>
                          setDialog({
                            mode: 'view',
                            taskId: task.id,
                            taskTitle: task.title,
                          })
                        }
                        onEdit={() => {
                          setOpenMenuId('')
                          setDialog({
                            mode: 'edit',
                            taskId: task.id,
                            taskTitle: task.title,
                          })
                        }}
                        onDelete={() =>
                          openDeleteConfirmation({
                            kind: 'single',
                            tasks: [task],
                          })
                        }
                        onToggleMenu={() =>
                          setOpenMenuId((currentId) =>
                            currentId === task.id ? '' : task.id,
                          )
                        }
                        onDragStart={(event) =>
                          handleDragStart(event, task, status)
                        }
                        onDragEnd={handleDragEnd}
                      />
                    ))
                  )}

                  {column.next_cursor && (
                    <button
                      className="tasks-column__load-more"
                      type="button"
                      disabled={loadingMoreStatus !== null}
                      onClick={() => void loadMore(status)}
                    >
                      {loadingMoreStatus === status
                        ? 'Загрузка…'
                        : `Показать ещё (${Math.max(
                            0,
                            column.count - column.tasks.length,
                          )})`}
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

      {dialog?.mode === 'edit' && (
        <TaskFormModal
          mode="edit"
          taskId={dialog.taskId}
          taskTitle={dialog.taskTitle}
          onClose={() => setDialog(null)}
          onCreated={() => handleTaskSaved('Задача создана.')}
          onUpdated={() => handleTaskSaved('Задача обновлена.')}
          onDeleted={() => handleTaskSaved('Задача удалена.')}
          onNotFound={handleTaskNotFound}
        />
      )}

      {dialog?.mode === 'view' && (
        <TaskViewModal
          taskId={dialog.taskId}
          taskTitle={dialog.taskTitle}
          onClose={() => setDialog(null)}
          onEdit={(task) =>
            setDialog({
              mode: 'edit',
              taskId: task.id,
              taskTitle: task.title,
            })
          }
          onDelete={(task) =>
            openDeleteConfirmation({
              kind: 'single',
              tasks: [task],
            })
          }
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
}: {
  task: ApiTask
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
}) {
  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest('button, input, a')
    ) {
      return
    }

    onOpen()
  }

  return (
    <article
      className={[
        'tasks-card',
        `tasks-card--${task.status}`,
        task.is_overdue && task.status !== 'done'
          ? 'tasks-card--overdue'
          : '',
        isSelected ? 'tasks-card--selected' : '',
        isMoving ? 'tasks-card--moving' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      draggable={!isMoving}
      aria-label={`${task.title}. ${taskStatusLabels[task.status].shortTitle}`}
      onClick={handleCardClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
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
            {task.created_by_ai && (
              <span className="tasks-card__ai-badge">AI</span>
            )}
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
                <button type="button" role="menuitem" onClick={onOpen}>
                  Просмотреть
                </button>
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

        <p className="tasks-card__contact" title={getTaskContactName(task)}>
          {getTaskContactName(task)}
        </p>

        <div className="tasks-card__meta">
          <span className={task.is_overdue ? 'is-overdue' : ''}>
            {task.is_overdue && task.status !== 'done' && (
              <b aria-label="Просрочено">!</b>
            )}
            {formatTaskDueDate(task)}
          </span>

          {task.deal && (
            <span title={task.deal.title}>
              Связанный объект: {task.deal.title}
            </span>
          )}

          {formatTaskAmount(task) && <strong>{formatTaskAmount(task)}</strong>}
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
  const modalRef = useRef<HTMLDivElement>(null)
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
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tasks-delete-title"
        aria-describedby="tasks-delete-text"
      >
        <span className="tasks-delete-modal__icon" aria-hidden="true">
          !
        </span>
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
              <span
                className="tasks-skeleton tasks-skeleton--card"
                key={index}
              />
            ))}
          </article>
        ))}
      </div>
    </section>
  )
}

function getTaskContactName(task: ApiTask) {
  if (!task.contact) {
    return 'Контакт не указан'
  }

  return task.contact.company || task.contact.name
}

function formatTaskDueDate(task: ApiTask) {
  if (!task.due_date || task.due_date_type === 'none') {
    return 'Без срока'
  }

  const date = new Date(task.due_date)

  if (Number.isNaN(date.getTime())) {
    return 'Срок не указан'
  }

  if (task.due_date_type === 'date') {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date)
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatTaskAmount(task: ApiTask) {
  if (!task.deal?.amount) {
    return ''
  }

  const amount = Number(task.deal.amount)

  if (!Number.isFinite(amount)) {
    return `${task.deal.amount} ${task.deal.currency}`
  }

  const formattedAmount = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount)

  return task.deal.currency === 'RUB'
    ? `${formattedAmount} ₽`
    : `${formattedAmount} ${task.deal.currency}`
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
