import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { ApiError } from '../../shared/api/apiClient'
import {
  getTask,
  type ApiTask,
  type ApiTaskDetail,
  type TaskStatus,
} from '../../shared/api/tasksApi'
import './TaskViewModal.css'

type TaskViewModalProps = {
  taskId: string
  taskTitle: string
  onClose: () => void
  onEdit: (task: ApiTaskDetail) => void
  onDelete: (task: ApiTask) => void
  onNotFound: () => void
}

const statusLabels: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Выполнена',
}

export function TaskViewModal({
  taskId,
  taskTitle,
  onClose,
  onEdit,
  onDelete,
  onNotFound,
}: TaskViewModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [task, setTask] = useState<ApiTaskDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function loadTask() {
      setIsLoading(true)
      setError('')

      try {
        const data = await getTask(taskId, controller.signal)
        setTask(data)
        window.setTimeout(() => closeButtonRef.current?.focus(), 0)
      } catch (loadError) {
        if (isAbortError(loadError)) {
          return
        }

        if (loadError instanceof ApiError && loadError.status === 404) {
          onNotFound()
          return
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Не удалось загрузить задачу.',
        )
      } finally {
        setIsLoading(false)
      }
    }

    void loadTask()
    return () => controller.abort()
  }, [onNotFound, requestVersion, taskId])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

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
      document.body.style.overflow = originalOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="task-view-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className="task-view-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-view-title"
        aria-busy={isLoading}
      >
        <header className="task-view-modal__header">
          <h2 id="task-view-title">Просмотр задачи</h2>
          <div>
            <button
              type="button"
              aria-label="Редактировать задачу"
              title="Редактировать"
              disabled={!task}
              onClick={() => task && onEdit(task)}
            >
              ✎
            </button>
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

        {isLoading ? (
          <div className="task-view-modal__state" role="status">
            <span className="task-view-modal__spinner" aria-hidden="true" />
            <p>Загружаем задачу «{taskTitle}»…</p>
          </div>
        ) : error || !task ? (
          <div className="task-view-modal__state">
            <p>{error || 'Не удалось загрузить задачу.'}</p>
            <button
              type="button"
              onClick={() =>
                setRequestVersion((currentVersion) => currentVersion + 1)
              }
            >
              Повторить
            </button>
          </div>
        ) : (
          <div className="task-view-modal__body">
            <div className="task-view-modal__title-row">
              <h3>{task.title}</h3>
              <div>
                <span className={`task-view-modal__status is-${task.status}`}>
                  {statusLabels[task.status]}
                </span>
                {task.is_overdue && task.status !== 'done' && (
                  <span className="task-view-modal__overdue">Просрочено</span>
                )}
                {task.created_by_ai && (
                  <span className="task-view-modal__ai">Создана AI</span>
                )}
              </div>
            </div>

            <TaskViewDetail
              label="Дата выполнения"
              value={formatTaskDueDate(task)}
            />

            <TaskViewDetail
              label="Описание"
              value={task.description || 'Описание не указано'}
              multiline
            />

            <div className="task-view-modal__relations">
              <TaskViewDetail
                label="Контакт"
                value={
                  task.contact
                    ? task.contact.company || task.contact.name
                    : 'Не указан'
                }
              />
              <TaskViewDetail
                label="Сделка"
                value={task.deal?.title || 'Не указана'}
              />
              <TaskViewDetail
                label="Сумма"
                value={formatTaskAmount(task) || '—'}
              />
            </div>

            <TaskViewDetail
              label="Комментарий"
              value={task.comment || 'Комментарий не указан'}
              multiline
            />

            <footer className="task-view-modal__actions">
              <button
                className="task-view-modal__delete"
                type="button"
                onClick={() => onDelete(task)}
              >
                Удалить
              </button>
              <button
                className="task-view-modal__edit"
                type="button"
                onClick={() => onEdit(task)}
              >
                Редактировать
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}

function TaskViewDetail({
  label,
  value,
  multiline = false,
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  return (
    <div
      className={`task-view-detail${
        multiline ? ' task-view-detail--multiline' : ''
      }`}
    >
      <span>{label}</span>
      <p>{value}</p>
    </div>
  )
}

function formatTaskDueDate(task: ApiTaskDetail) {
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

function formatTaskAmount(task: ApiTaskDetail) {
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
