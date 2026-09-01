import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { closeCurrentAiChatSession } from '../../shared/api/aiChatApi'
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

const MAX_MESSAGE_LENGTH = 1000
const MAX_TEXTAREA_HEIGHT = 104

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
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
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
    const input = inputRef.current
    if (!input) {
      return
    }

    input.style.height = 'auto'
    const nextHeight = Math.min(input.scrollHeight, MAX_TEXTAREA_HEIGHT)
    input.style.height = `${nextHeight}px`
    input.style.overflowY = input.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden'
  }, [messageText])

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

  const handleClose = () => {
    void closeCurrentAiChatSession().catch(() => undefined)
    onClose()
  }

  return (
    <div className="ai-assistant-overlay" role="presentation" onMouseDown={handleClose}>
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

          <button className="ai-assistant-close" type="button" aria-label="Закрыть" onClick={handleClose}>
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
                    <AiMessageContent text={message.text} />
                    <div className="ai-assistant-message__meta">
                      <time>{formatMessageTime(message.createdAt)}</time>
                      <span>{messageStatusLabel(messages, message, index, isLoading)}</span>
                    </div>
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
          <textarea
            ref={inputRef}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Введите вопрос..."
            aria-label="Сообщение для Анны AI"
            value={messageText}
            disabled={isInputDisabled}
            onChange={(event) => setMessageText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSubmit()
              }
            }}
          />

          <button type="submit" aria-label="Отправить сообщение" disabled={isInputDisabled}>
            {isLoading ? '…' : '↗'}
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

function formatMessageDate(value: string | null) {
  if (!value) {
    return 'Без даты'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Без даты'
  }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDifference = Math.round(
    (today.getTime() - messageDay.getTime()) / 86_400_000,
  )

  if (dayDifference === 0) {
    return 'Сегодня'
  }

  if (dayDifference === 1) {
    return 'Вчера'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function formatMessageTime(value: string | null) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatSessionTitle(sessionId: string | null) {
  if (!sessionId) {
    return 'Текущая сессия'
  }

  return `Сессия ${sessionId.slice(0, 8)}`
}

function messageStatusLabel(
  messages: AiChatMessage[],
  message: AiChatMessage,
  index: number,
  isLoading: boolean,
) {
  if (message.role === 'assistant') {
    return message.id.startsWith('assistant-error-') ? 'Ошибка' : 'Готово'
  }

  const expectedErrorId = message.id.replace('user-message-', 'assistant-error-')
  if (messages[index + 1]?.id === expectedErrorId) {
    return 'Ошибка отправки'
  }

  if (isLoading && index === messages.length - 1) {
    return 'Отправляется...'
  }

  return 'Отправлено'
}

function AiMessageContent({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    if (/^\s*-\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*-\s+/, ''))
        index += 1
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''))
        index += 1
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      )
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length
      && lines[index].trim()
      && !/^\s*-\s+/.test(lines[index])
      && !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index])
      index += 1
    }

    blocks.push(
      <p key={`p-${index}`}>
        {paragraphLines.map((paragraphLine, lineIndex) => (
          <Fragment key={lineIndex}>
            {lineIndex > 0 && <br />}
            {renderInlineMarkdown(paragraphLine)}
          </Fragment>
        ))}
      </p>,
    )
  }

  return <div className="ai-assistant-markdown">{blocks}</div>
}

function renderInlineMarkdown(text: string) {
  const tokenPattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  const parts = text.split(tokenPattern).filter(Boolean)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }

    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      const href = normalizeCrmMarkdownHref(linkMatch[2])
      if (href) {
        return (
          <a key={index} href={href} target="_blank" rel="noopener noreferrer">
            {linkMatch[1]}
          </a>
        )
      }
      return <span key={index}>{linkMatch[1]}</span>
    }

    return <Fragment key={index}>{part}</Fragment>
  })
}

function normalizeCrmMarkdownHref(rawHref: string) {
  if (!rawHref.startsWith('/') || rawHref.startsWith('//')) {
    return ''
  }

  const target = new URL(rawHref, window.location.origin)
  if (target.origin !== window.location.origin) {
    return ''
  }

  const parts = target.pathname.split('/').filter(Boolean)
  if (parts.length !== 2) {
    return target.pathname.startsWith('/app/') ? rawHref : ''
  }

  const [entityType, encodedId] = parts
  const id = safeDecodeURIComponent(encodedId)
  const routes: Record<string, { path: string; idParam: string }> = {
    deals: { path: '/app/deals', idParam: 'deal_id' },
    contacts: { path: '/app/contacts', idParam: 'contact_id' },
    tasks: { path: '/app/tasks', idParam: 'task_id' },
    chat: { path: '/app/chats', idParam: 'chat_id' },
  }
  const route = routes[entityType]

  if (!route || !id) {
    return ''
  }

  const searchParams = new URLSearchParams(target.search)
  searchParams.set(route.idParam, id)
  const query = searchParams.toString()
  return `${route.path}${query ? `?${query}` : ''}${target.hash}`
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
