import './AiAssistantModal.css'

type AiAssistantModalProps = {
  onClose: () => void
}

const mockTasks = [
  {
    title: 'Подписать договор',
    company: 'ООО "Тормонт"',
    meta: '350 000 ₽ · Связанный объект: сделка №809',
    isOverdue: true,
  },
  {
    title: 'Встреча с клиентом',
    company: 'ООО "Тормонт"',
    meta: '600 000 ₽ · Связанный объект: контакт: Иванов П.А.',
  },
  {
    title: 'Позвонить',
    company: 'ООО "Заря"',
    meta: '450 000 ₽ · Связанный объект: сделка №789',
  },
]

export function AiAssistantModal({ onClose }: AiAssistantModalProps) {
  return (
    <div className="ai-assistant-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="ai-assistant-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-assistant-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ai-assistant-header">
          <div className="ai-assistant-title-block">
            <span className="ai-assistant-sparkle" aria-hidden="true">
              ✨
            </span>
            <h2 id="ai-assistant-title">Анна AI</h2>
          </div>

          <button className="ai-assistant-close" type="button" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="ai-assistant-body">
          <div className="ai-assistant-message ai-assistant-message--user">
            Какие задачи на сегодня с высоким приоритетом?
          </div>

          <div className="ai-assistant-message ai-assistant-message--anna">
            Вот список задач с высоким приоритетом на сегодня.
          </div>

          <div className="ai-assistant-task-list">
            {mockTasks.map((task) => (
              <article className="ai-assistant-task" key={task.title}>
                <div className="ai-assistant-task__top">
                  <div>
                    <h3>{task.title}</h3>
                    {task.isOverdue && <span>просрочено</span>}
                  </div>

                  <button type="button" aria-label="Действия с задачей">
                    ⋮
                  </button>
                </div>

                <p className="ai-assistant-task__company">{task.company}</p>
                <p className="ai-assistant-task__meta">{task.meta}</p>
              </article>
            ))}
          </div>
        </div>

        <form className="ai-assistant-input-row" onSubmit={(event) => event.preventDefault()}>
          <input type="text" placeholder="Сообщение" aria-label="Сообщение для Анны AI" />

          <button type="submit" aria-label="Отправить сообщение">
            ↗
          </button>
        </form>
      </section>
    </div>
  )
}