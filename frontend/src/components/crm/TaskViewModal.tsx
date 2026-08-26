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
} from '../../shared/api/tasksApi'
import { getWorkspaceSettings } from '../../shared/api/workspaceSettingsApi'
import './TaskViewModal.css'

type TaskViewModalProps = {
  taskId: string
  taskTitle: string
  onClose: () => void
  onEdit: (task: ApiTaskDetail) => void
  onDelete: (task: ApiTask) => void
  onNotFound: () => void
}

export function TaskViewModal({
  taskId,
  taskTitle,
  onClose,
  onEdit,
  onNotFound,
}: TaskViewModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [task, setTask] = useState<ApiTaskDetail | null>(null)
  const [workspaceTimezone, setWorkspaceTimezone] = useState('UTC')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function loadTask() {
      setIsLoading(true)
      setError('')

      try {
        const [data, settings] = await Promise.all([
          getTask(taskId, controller.signal),
          getWorkspaceSettings().catch(() => null),
        ])
        setTask(data)
        setWorkspaceTimezone(settings?.timezone || 'UTC')
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
              className="task-view-modal__edit-icon"
              type="button"
              aria-label="Редактировать задачу"
              title="Редактировать"
              disabled={!task}
              onClick={() => task && onEdit(task)}
            >
              <span aria-hidden="true" />
            </button>
            <button
              className="task-view-modal__close-icon"
              ref={closeButtonRef}
              type="button"
              aria-label="Закрыть"
              onClick={onClose}
            >
              <span aria-hidden="true" />
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
            <h3>{task.title}</h3>

            <p className="task-view-modal__due">
              Дата выполнения: {formatTaskDueDate(task, workspaceTimezone)}
            </p>

            <p className="task-view-modal__description">
              {task.description || 'Описание не указано'}
            </p>

            <div className="task-view-modal__relations">
              <span>{task.contact?.name || 'Клиент не указан'}</span>
              <span>
                {task.deal ? `Сделка «${task.deal.title}»` : 'Сделка не указана'}
              </span>
              <span>{formatTaskAmount(task) || '—'}</span>
            </div>

            <div className="task-view-modal__comment">
              {task.comment || 'Комментарий'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function formatTaskDueDate(task: ApiTaskDetail, workspaceTimezone: string) {
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
      timeZone: workspaceTimezone,
    }).format(date)
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: workspaceTimezone,
  }).format(date)
}

function formatTaskAmount(task: ApiTaskDetail) {
  if (!task.deal || task.deal.amount == null) {
    return ''
  }

  const amount = Number(task.deal.amount)

  if (!Number.isFinite(amount)) {
    return `${task.deal.amount} ${task.deal.currency}`
  }

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
