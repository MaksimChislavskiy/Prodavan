import { Fragment, useEffect, useRef, useState } from 'react'
import './AiAssistantModal.css'

export type AiChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  sessionId: string | null
  createdAt: string | null
}

type OlderHistoryScrollSnapshot = {
  scrollHeight: number
  scrollTop: number
}

type AiAssistantModalProps = {
  messages: AiChatMessage[]
  isLoading: boolean
  isHistoryLoading: boolean
  isOlderHistoryLoading: boolean
  hasMoreHistory: boolean
  onLoadOlderHistory: () => void
  onSendMessage: (message: string) => void
  onClose: () => void
}

export function AiAssistantModal({
  messages,
  isLoading,
  isHistoryLoading,
  isOlderHistoryLoading,
  hasMoreHistory,
  onLoadOlderHistory,
  onSendMessage,
  onClose,
}: AiAssistantModalProps) {
  const [messageText, setMessageText] = useState('')
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const previousFirstMessageIdRef = useRef<string | null>(null)
  const previousLastMessageIdRef = useRef<string | null>(null)
  const olderHistoryScrollSnapshotRef = useRef<OlderHistoryScrollSnapshot | null>(null)
  const isOlderHistoryRequestedRef = useRef(false)

  const hasMessages = messages.length > 0
  const isInputDisabled = isLoading || isHistoryLoading || isOlderHistoryLoading

  useEffect(() => {
    if (!isInputDisabled) {
      inputRef.current?.focus()
    }
  }, [isInputDisabled])

  useEffect(() => {
    if (isHistoryLoading) {
      return
    }

    const bodyElement = bodyRef.current

    if (!bodyElement) {
      return
    }

    const olderHistoryScrollSnapshot = olderHistoryScrollSnapshotRef.current

    if (olderHistoryScrollSnapshot && !isOlderHistoryLoading) {
      requestAnimationFrame(() => {
        const heightDifference = bodyElement.scrollHeight - olderHistoryScrollSnapshot.scrollHeight

        bodyElement.scrollTop = olderHistoryScrollSnapshot.scrollTop + heightDifference
        olderHistoryScrollSnapshotRef.current = null
        isOlderHistoryRequestedRef.current = false
      })

      return
    }

    if (isOlderHistoryLoading) {
      return
    }

    const firstMessageId = messages[0]?.id ?? null
    const lastMessageId = messages[messages.length - 1]?.id ?? null
    const previousFirstMessageId = previousFirstMessageIdRef.current
    const previousLastMessageId = previousLastMessageIdRef.current

    previousFirstMessageIdRef.current = firstMessageId
    previousLastMessageIdRef.current = lastMessageId

    const isOlderMessagesPrepended =
      previousFirstMessageId !== null &&
      previousLastMessageId !== null &&
      firstMessageId !== previousFirstMessageId &&
      lastMessageId === previousLastMessageId

    if (isOlderMessagesPrepended) {
      return
    }

    requestAnimationFrame(() => {
      bodyElement.scrollTop = bodyElement.scrollHeight
    })
  }, [messages, isLoading, isHistoryLoading, isOlderHistoryLoading])

  const handleBodyScroll = () => {
    const bodyElement = bodyRef.current

    if (!bodyElement) {
      return
    }

    if (
      bodyElement.scrollTop > 80 ||
      !hasMoreHistory ||
      isHistoryLoading ||
      isOlderHistoryLoading ||
      isOlderHistoryRequestedRef.current
    ) {
      return
    }

    olderHistoryScrollSnapshotRef.current = {
      scrollHeight: bodyElement.scrollHeight,
      scrollTop: bodyElement.scrollTop,
    }

    isOlderHistoryRequestedRef.current = true
    onLoadOlderHistory()
  }

  const focusInput = () => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  const handleSubmit = () => {
    const normalizedMessage = messageText.trim()

    if (!normalizedMessage || isInputDisabled) {
      return
    }

    onSendMessage(normalizedMessage)
    setMessageText('')
    focusInput()
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

        <div className="ai-assistant-body" ref={bodyRef} onScroll={handleBodyScroll}>
          {isHistoryLoading ? (
            <div className="ai-assistant-loading-state">
              <div className="ai-assistant-loading-state__icon" aria-hidden="true">
                ✨
              </div>

              <p>Загружаем историю...</p>
            </div>
          ) : hasMessages ? (
            <>
              {isOlderHistoryLoading && (
                <div className="ai-assistant-older-loading">
                  Загружаем более ранние сообщения...
                </div>
              )}

              {messages.map((message, index) => (
                <Fragment key={message.id}>
                  {shouldShowSessionDivider(messages, message, index) && (
                    <div className="ai-assistant-session-divider">
                      <span>{formatMessageDate(message.createdAt)}</span>
                      <strong>{formatSessionTitle(message.sessionId)}</strong>
                    </div>
                  )}

                  <div
                    className={
                      message.role === 'user'
                        ? 'ai-assistant-message ai-assistant-message--user'
                        : 'ai-assistant-message ai-assistant-message--anna'
                    }
                  >
                    {message.text}
                  </div>
                </Fragment>
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
            ref={inputRef}
            type="text"
            placeholder="Сообщение"
            aria-label="Сообщение для Анны AI"
            value={messageText}
            disabled={isInputDisabled}
            onChange={(event) => setMessageText(event.target.value)}
          />

          <button type="submit" aria-label="Отправить сообщение" disabled={isInputDisabled}>
            ↗
          </button>
        </form>
      </section>
    </div>
  )
}

function shouldShowSessionDivider(
  messages: AiChatMessage[],
  message: AiChatMessage,
  index: number,
) {
  if (index === 0) {
    return true
  }

  const previousMessage = messages[index - 1]

  return (
    previousMessage.sessionId !== message.sessionId ||
    getMessageDateKey(previousMessage.createdAt) !== getMessageDateKey(message.createdAt)
  )
}

function getMessageDateKey(date: string | null) {
  if (!date) {
    return 'unknown-date'
  }

  return new Date(date).toDateString()
}

function formatMessageDate(date: string | null) {
  if (!date) {
    return 'Без даты'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(date))
}

function formatSessionTitle(sessionId: string | null) {
  if (!sessionId) {
    return 'Текущая сессия'
  }

  return `Сессия ${sessionId.slice(0, 8)}`
}