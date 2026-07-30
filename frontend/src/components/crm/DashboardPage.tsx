import { useEffect, useState, type MouseEvent } from 'react'
import {
  deleteTask,
  getTasksDashboard,
  type ApiDashboardTask,
  type ApiTask,
} from '../../shared/api/tasksApi'
import { TaskFormModal } from './TaskFormModal'
import { TaskViewModal } from './TaskViewModal'
import './DashboardPage.css'

type DashboardState = {
  tasks: ApiDashboardTask[]
  totalCount: number
  isLoading: boolean
  error: string
}

type DashboardDialog =
  | { mode: 'view'; task: ApiDashboardTask }
  | { mode: 'edit'; task: ApiDashboardTask }

export function DashboardPage({ onShowAll }: { onShowAll: () => void }) {
  const [state, setState] = useState<DashboardState>({
    tasks: [],
    totalCount: 0,
    isLoading: true,
    error: '',
  })
  const [reloadVersion, setReloadVersion] = useState(0)
  const [dialog, setDialog] = useState<DashboardDialog | null>(null)
  const [openMenuId, setOpenMenuId] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ApiDashboardTask | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadDashboard() {
      setState((current) => ({ ...current, isLoading: true, error: '' }))

      try {
        const data = await getTasksDashboard(controller.signal)
        setState({
          tasks: data.tasks,
          totalCount: data.total_count,
          isLoading: false,
          error: '',
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        setState({
          tasks: [],
          totalCount: 0,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Не удалось загрузить задачи.',
        })
      }
    }

    void loadDashboard()
    return () => controller.abort()
  }, [reloadVersion])

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.dashboard-task-menu')) {
        return
      }
      setOpenMenuId('')
    }

    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [])

  const reload = () => {
    setDialog(null)
    setOpenMenuId('')
    setReloadVersion((version) => version + 1)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || isDeleting) {
      return
    }

    setIsDeleting(true)
    setDeleteError('')

    try {
      await deleteTask(deleteTarget.id)
      setDeleteTarget(null)
      reload()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Не удалось удалить задачу.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <main className="dashboard-page">
        <section className="dashboard-today" aria-labelledby="dashboard-today-title">
          <header className="dashboard-today__header">
            <div className="dashboard-today__heading">
              <h1 id="dashboard-today-title">Важное на сегодня</h1>
              <span className="dashboard-hint">
                <button type="button" aria-label="Подсказка о задачах на сегодня">?</button>
                <span role="tooltip">План на сегодня: приоритеты и дедлайны</span>
              </span>
            </div>

            {state.totalCount > 10 && (
              <button className="dashboard-today__show-all" type="button" onClick={onShowAll}>
                Показать все
              </button>
            )}
          </header>

          {state.isLoading && <DashboardSkeleton />}

          {!state.isLoading && state.error && (
            <div className="dashboard-state" role="alert">
              <strong>Не удалось загрузить задачи</strong>
              <p>{state.error}</p>
              <button type="button" onClick={reload}>Повторить</button>
            </div>
          )}

          {!state.isLoading && !state.error && state.tasks.length === 0 && (
            <div className="dashboard-state dashboard-state--empty">
              <span aria-hidden="true">✓</span>
              <strong>На сегодня задач нет. Отличная работа!</strong>
            </div>
          )}

          {!state.isLoading && !state.error && state.tasks.length > 0 && (
            <div className="dashboard-task-grid">
              {state.tasks.map((task) => (
                <DashboardTaskCard
                  key={task.id}
                  task={task}
                  isMenuOpen={openMenuId === task.id}
                  onOpen={() => setDialog({ mode: 'view', task })}
                  onEdit={() => {
                    setOpenMenuId('')
                    setDialog({ mode: 'edit', task })
                  }}
                  onDelete={() => {
                    setOpenMenuId('')
                    setDeleteError('')
                    setDeleteTarget(task)
                  }}
                  onToggleMenu={() =>
                    setOpenMenuId((currentId) => currentId === task.id ? '' : task.id)
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
          onNotFound={reload}
        />
      )}

      {dialog?.mode === 'edit' && (
        <TaskFormModal
          mode="edit"
          taskId={dialog.task.id}
          taskTitle={dialog.task.title}
          onClose={() => setDialog(null)}
          onCreated={reload}
          onUpdated={reload}
          onDeleted={reload}
          onNotFound={reload}
        />
      )}

      {deleteTarget && (
        <div className="dashboard-delete-overlay" role="presentation">
          <div className="dashboard-delete-modal" role="alertdialog" aria-modal="true">
            <h2>Удалить задачу?</h2>
            <p>Задача «{deleteTarget.title}» будет удалена. Действие невозможно отменить.</p>
            {deleteError && <p className="dashboard-delete-modal__error">{deleteError}</p>}
            <div>
              <button type="button" disabled={isDeleting} onClick={() => setDeleteTarget(null)}>
                Отмена
              </button>
              <button type="button" disabled={isDeleting} onClick={() => void confirmDelete()}>
                {isDeleting ? 'Удаление…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function DashboardTaskCard({
  task,
  isMenuOpen,
  onOpen,
  onEdit,
  onDelete,
  onToggleMenu,
}: {
  task: ApiDashboardTask
  isMenuOpen: boolean
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleMenu: () => void
}) {
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('button')) {
      return
    }
    onOpen()
  }

  return (
    <article className="dashboard-task-card" onClick={handleClick}>
      <div className="dashboard-task-card__top">
        <h2>{task.title}</h2>
        <div className="dashboard-task-menu">
          <button
            type="button"
            aria-label={`Действия с задачей ${task.title}`}
            aria-expanded={isMenuOpen}
            onClick={onToggleMenu}
          >
            ⋮
          </button>
          {isMenuOpen && (
            <div className="dashboard-task-menu__popup" role="menu">
              <button type="button" role="menuitem" onClick={onEdit}>Редактировать</button>
              <button type="button" role="menuitem" onClick={onDelete}>Удалить задачу</button>
            </div>
          )}
        </div>
      </div>

      <dl>
        <div><dt>Клиент:</dt><dd>{getTaskClientName(task)}</dd></div>
        <div><dt>Сумма:</dt><dd>{getTaskAmount(task) || '—'}</dd></div>
        <div><dt>Дедлайн:</dt><dd className={task.is_overdue ? 'is-overdue' : ''}>{getTaskDueText(task)}</dd></div>
      </dl>
    </article>
  )
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-task-grid" aria-label="Загрузка задач" aria-busy="true">
      {[0, 1, 2, 3].map((item) => <span className="dashboard-skeleton" key={item} />)}
    </div>
  )
}

function getTaskClientName(task: ApiTask) {
  return task.contact?.name || 'Не указан'
}

function getTaskAmount(task: ApiTask) {
  if (!task.deal?.amount) {
    return ''
  }
  return `${new Intl.NumberFormat('ru-RU').format(Number(task.deal.amount))} ${task.deal.currency}`
}

function getTaskDueText(task: ApiTask) {
  if (!task.due_date || task.due_date_type === 'none') {
    return 'Без срока'
  }

  const date = new Date(task.due_date)
  if (Number.isNaN(date.getTime())) {
    return 'Срок указан'
  }

  return task.due_date_type === 'date'
    ? date.toLocaleDateString('ru-RU')
    : date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}
