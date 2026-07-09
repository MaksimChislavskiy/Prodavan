import { useEffect, useState } from 'react'
import { getTasksDashboard, type ApiDashboardTask } from '../../shared/api/tasksApi'
import './DashboardPage.css'

type DashboardState = {
  tasks: ApiDashboardTask[]
  totalCount: number
  isLoading: boolean
  error: string
}

export function DashboardPage() {
  const [dashboardState, setDashboardState] = useState<DashboardState>({
    tasks: [],
    totalCount: 0,
    isLoading: true,
    error: '',
  })

  useEffect(() => {
    let isMounted = true

    async function loadDashboard() {
      try {
        const data = await getTasksDashboard()

        if (isMounted) {
          setDashboardState({
            tasks: data.tasks,
            totalCount: data.total_count,
            isLoading: false,
            error: '',
          })
        }
      } catch (error) {
        if (isMounted) {
          setDashboardState({
            tasks: [],
            totalCount: 0,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Не удалось загрузить рабочий стол',
          })
        }
      }
    }

    void loadDashboard()

    return () => {
      isMounted = false
    }
  }, [])

  const hasTasks = dashboardState.tasks.length > 0

  return (
    <main className="dashboard-page">
      <section className="dashboard-header">
        <p className="dashboard-header__eyebrow">CRM</p>
        <h1 className="dashboard-header__title">Рабочий стол</h1>
        <p className="dashboard-header__text">
          Главная страница CRM. Здесь отображаются задачи на сегодня, просроченные задачи и
          задачи без срока.
        </p>
      </section>

      <section className="today-panel" aria-labelledby="today-panel-title">
        <div className="today-panel__header">
          <div>
            <h2 className="today-panel__title" id="today-panel-title">
              Важное на сегодня
            </h2>
            <p className="today-panel__subtitle">
              Задачи, приоритеты и дедлайны на текущий день
              {dashboardState.totalCount > 0 && ` · всего: ${dashboardState.totalCount}`}
            </p>
          </div>

          <button className="today-panel__info" type="button" aria-label="Подсказка">
            i
            <span className="today-panel__tooltip">
              План на сегодня: приоритеты и дедлайны
            </span>
          </button>
        </div>

        {dashboardState.isLoading && (
          <div className="today-panel__empty">
            <div className="today-panel__empty-icon" aria-hidden="true">
              …
            </div>

            <h3 className="today-panel__empty-title">Загружаем задачи...</h3>
            <p className="today-panel__empty-text">
              Получаем данные рабочего стола из backend.
            </p>
          </div>
        )}

        {!dashboardState.isLoading && dashboardState.error && (
          <div className="today-panel__empty">
            <div className="today-panel__empty-icon" aria-hidden="true">
              !
            </div>

            <h3 className="today-panel__empty-title">Не удалось загрузить задачи</h3>
            <p className="today-panel__empty-text">{dashboardState.error}</p>
          </div>
        )}

        {!dashboardState.isLoading && !dashboardState.error && hasTasks && (
          <div className="task-list" aria-label="Список задач на сегодня">
            {dashboardState.tasks.map((task) => (
              <article className="task-card" key={task.id}>
                <div className="task-card__top">
                  <h3 className="task-card__title">{task.title}</h3>

                  <button className="task-card__menu" type="button" aria-label="Действия с задачей">
                    ⋮
                  </button>
                </div>

                <div className="task-card__meta">
                  <div className="task-card__meta-item">
                    <span className="task-card__meta-label">Клиент</span>
                    <span className="task-card__meta-value">{getTaskClientName(task)}</span>
                  </div>

                  {getTaskAmount(task) && (
                    <div className="task-card__meta-item">
                      <span className="task-card__meta-label">Сумма</span>
                      <span className="task-card__meta-value">{getTaskAmount(task)}</span>
                    </div>
                  )}

                  <div className="task-card__meta-item">
                    <span className="task-card__meta-label">Срок</span>
                    <span className="task-card__meta-value">{getTaskDueText(task)}</span>
                  </div>
                </div>

                <div className="task-card__bottom">
                  {task.deal && (
                    <span className="task-card__deal">
                      Сделка: <strong>{task.deal.title}</strong>
                    </span>
                  )}

                  {task.is_overdue && <span className="task-card__badge">просрочено</span>}
                </div>
              </article>
            ))}
          </div>
        )}

        {!dashboardState.isLoading && !dashboardState.error && !hasTasks && (
          <div className="today-panel__empty">
            <div className="today-panel__empty-icon" aria-hidden="true">
              ✓
            </div>

            <h3 className="today-panel__empty-title">На сегодня задач нет. Отличная работа!</h3>
            <p className="today-panel__empty-text">
              Когда появятся задачи с дедлайном на сегодня, просроченные задачи или задачи без срока,
              они будут отображаться в этом блоке.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

function getTaskClientName(task: ApiDashboardTask) {
  if (!task.contact) {
    return 'Не указан'
  }

  return task.contact.company || task.contact.name
}

function getTaskAmount(task: ApiDashboardTask) {
  if (!task.deal?.amount) {
    return ''
  }

  return `${task.deal.amount} ${task.deal.currency}`
}

function getTaskDueText(task: ApiDashboardTask) {
  if (!task.due_date || task.due_date_type === 'none') {
    return 'Без срока'
  }

  const date = new Date(task.due_date)

  if (Number.isNaN(date.getTime())) {
    return 'Срок указан'
  }

  if (task.due_date_type === 'date') {
    return date.toLocaleDateString('ru-RU')
  }

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}