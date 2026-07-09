import './DashboardPage.css'

export function DashboardPage() {
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
      </section>
    </main>
  )
}