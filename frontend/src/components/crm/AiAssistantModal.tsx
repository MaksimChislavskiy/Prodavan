import { useState } from 'react'
import './AiAssistantModal.css'

export type AiChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type AiAssistantModalProps = {
  messages: AiChatMessage[]
  isLoading: boolean
  onSendMessage: (message: string) => void
  onClose: () => void
}

export function AiAssistantModal({
  messages,
  isLoading,
  onSendMessage,
  onClose,
}: AiAssistantModalProps) {
  const [messageText, setMessageText] = useState('')

  const hasMessages = messages.length > 0

  const handleSubmit = () => {
    const normalizedMessage = messageText.trim()

    if (!normalizedMessage || isLoading) {
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

              {isLoading && (
                <div className="ai-assistant-message ai-assistant-message--anna ai-assistant-message--loading">
                  AI анализирует запрос...
                </div>
              )}
            </>
          ) : (
            <div className="ai-assistant-empty-state">
              <div className="ai-assistant-empty-state__icon" aria-hidden="true">
                ✨
              </div>

              <h3>Здравствуйте, я Анна AI</h3>
              <p>
                Задайте вопрос по CRM, задачам, сделкам, клиентам или базе знаний.
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
            disabled={isLoading}
            onChange={(event) => setMessageText(event.target.value)}
          />

          <button type="submit" aria-label="Отправить сообщение" disabled={isLoading}>
            ↗
          </button>
        </form>
      </section>
    </div>
  )
}