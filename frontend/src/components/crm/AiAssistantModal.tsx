import { useState } from 'react'
import './AiAssistantModal.css'

export type AiChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type AiAssistantModalProps = {
  messages: AiChatMessage[]
  onSendMessage: (message: string) => void
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

export function AiAssistantModal({ messages, onSendMessage, onClose }: AiAssistantModalProps) {
  const [messageText, setMessageText] = useState('')

  const hasMessages = messages.length > 0

  const handleSubmit = () => {
    const normalizedMessage = messageText.trim()

    if (!normalizedMessage) {
      return
    }

    onSendMessage(normalizedMessage)
    setMessageText('')
  }

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
          {hasMessages ? (
            <>
              {messages.map((message) => (
                <div
                  className={
                    message.role === 'user'
                      ? 'ai-assistant-message ai-assistant-message--user'
                      : 'ai-assistant-message ai-assistant-message--anna'
                  }
                  key={message.id}
                >
                  {message.text}
                </div>
              ))}

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
            </>
          ) : (
            <div className="ai-assistant-empty-state">
              <div className="ai-assistant-empty-state__icon" aria-hidden="true">
                ✨
              </div>

              <h3>Здравствуйте, я Анна AI</h3>
              <p>
                Задайте вопрос по CRM, задачам, сделкам, клиентам или базе знаний. Позже здесь будет
                отображаться история диалога.
              </p>
            </div>
          )}
        </div>

        <form
          className="ai-assistant-input-row"
          onSubmit={(event) => {
            event.preventDefault()
            handleSubmit()
          }}
        >
          <input
            type="text"
            placeholder="Сообщение"
            aria-label="Сообщение для Анны AI"
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
          />

          <button type="submit" aria-label="Отправить сообщение">
            ↗
          </button>
        </form>
      </section>
    </div>
  )
}