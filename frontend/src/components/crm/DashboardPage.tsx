import './DashboardPage.css'

type DashboardTask = {
  id: string
  title: string
  clientName: string
  amount?: string
  dueText: string
  dealName?: string
  isOverdue?: boolean
}

const mockTasks: DashboardTask[] = [
  {
    id: '1',
    title: 'Позвонить клиенту и уточнить бюджет',
    clientName: 'ООО Ромашка',
    amount: '150 000 ₽',
    dueText: 'сегодня, 15:00',
    dealName: 'Поставка мебели',
  },
  {
    id: '2',
    title: 'Отправить коммерческое предложение',
    clientName: 'Иван Петров',
    amount: '80 000 ₽',
    dueText: 'просрочено с 10:30',
    dealName: 'CRM для отдела продаж',
    isOverdue: true,
  },
  {
    id: '3',
    title: 'Проверить входящие сообщения в чате',
    clientName: 'Не указан',
    dueText: 'Без срока',
  },
]

export function DashboardPage() {
  const hasTasks = mockTasks.length > 0

  return (
    <main className="dashboard-page">
      <section className="dashboard-header">
        <p className="dashboard-header__eyebrow">CRM</p>
        <h1 className="dashboard-header__title">Рабочий стол</h1>
        <p className="dashboard-header__text">
          Главная страница CRM. Позже здесь будут задачи на сегодня, просроченные задачи и быстрые
          действия менеджера.
        </p>
      </section>

      <section className="today-panel" aria-labelledby="today-panel-title">
        <div className="today-panel__header">
          <div>
            <h2 className="today-panel__title" id="today-panel-title">
              Важное на сегодня
            </h2>
            <p className="today-panel__subtitle">Задачи, приоритеты и дедлайны на текущий день</p>
          </div>

          <button className="today-panel__info" type="button" aria-label="Подсказка">
            i
            <span className="today-panel__tooltip">
              План на сегодня: приоритеты и дедлайны
            </span>
          </button>
        </div>

        {hasTasks ? (
          <div className="task-list" aria-label="Список задач на сегодня">
            {mockTasks.map((task) => (
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
                    <span className="task-card__meta-value">{task.clientName}</span>
                  </div>

                  {task.amount && (
                    <div className="task-card__meta-item">
                      <span className="task-card__meta-label">Сумма</span>
                      <span className="task-card__meta-value">{task.amount}</span>
                    </div>
                  )}

                  <div className="task-card__meta-item">
                    <span className="task-card__meta-label">Срок</span>
                    <span className="task-card__meta-value">{task.dueText}</span>
                  </div>
                </div>

                <div className="task-card__bottom">
                  {task.dealName && (
                    <span className="task-card__deal">
                      Сделка: <strong>{task.dealName}</strong>
                    </span>
                  )}

                  {task.isOverdue && <span className="task-card__badge">просрочено</span>}
                </div>
              </article>
            ))}
          </div>
        ) : (
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