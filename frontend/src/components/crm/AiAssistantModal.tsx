import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  closeCurrentAiChatSession,
  getCurrentAiChatSessionId,
  getRememberedAiChatMessage,
  refreshAiChatMessage,
  retryAiChatMessage,
  type AiChatMessageStatus,
  type ApiAiChatMessage,
} from '../../shared/api/aiChatApi'
import './AiAssistantModal.css'

export type AiChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  sessionId: string | null
  createdAt: string | null
}

type ResolvedAiChatMessage = AiChatMessage & {
  status: AiChatMessageStatus | null
  parentMessageId: string | null
}

type RuntimeMessageState = {
  status: AiChatMessageStatus
  text?: string
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
const PENDING_POLL_INTERVAL_MS = 4000
const MAX_PENDING_POLL_ATTEMPTS = 30

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
  const [retryMessages, setRetryMessages] = useState<AiChatMessage[]>([])
  const [runtimeMessageState, setRuntimeMessageState] = useState<
    Record<string, RuntimeMessageState>
  >({})
  const [pollTimedOutIds, setPollTimedOutIds] = useState<Record<string, boolean>>({})
  const [retryingParentIds, setRetryingParentIds] = useState<Record<string, boolean>>({})
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const previousFirstMessageIdRef = useRef<string | null>(null)
  const previousLastMessageIdRef = useRef<string | null>(null)
  const olderHistoryScrollSnapshotRef = useRef<OlderHistoryScrollSnapshot | null>(null)
  const isOlderHistoryRequestedRef = useRef(false)
  const pollAttemptsRef = useRef(new Map<string, number>())
  const inFlightPollsRef = useRef(new Set<string>())

  const sourceMessages = [...messages, ...retryMessages]
  const resolvedMessages = groupMessagesForDisplay(
    sourceMessages.map((message) =>
      resolveAiChatMessage(message, runtimeMessageState),
    ),
  )
  const hasMessages = resolvedMessages.length > 0
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

    const firstMessageId = resolvedMessages[0]?.id ?? null
    const lastMessageId = resolvedMessages[resolvedMessages.length - 1]?.id ?? null
    const previousFirstMessageId = previousFirstMessageIdRef.current
    const previousLastMessageId = previousLastMessageIdRef.current

    previousFirstMessageIdRef.current = firstMessageId
    previousLastMessageIdRef.current = lastMessageId

    const isOlderMessagesPrepended =
      previousFirstMessageId !== null
      && previousLastMessageId !== null
      && firstMessageId !== previousFirstMessageId
      && lastMessageId === previousLastMessageId

    if (isOlderMessagesPrepended) {
      return
    }

    requestAnimationFrame(() => {
      bodyElement.scrollTop = bodyElement.scrollHeight
    })
  }, [
    resolvedMessages,
    isLoading,
    isHistoryLoading,
    isOlderHistoryLoading,
  ])

  useEffect(() => {
    const pendingIds = sourceMessages
      .filter((message) => message.role === 'assistant')
      .map((message) => resolveAiChatMessage(message, runtimeMessageState))
      .filter(
        (message) =>
          (message.status === 'pending' || message.status === 'streaming')
          && !pollTimedOutIds[message.id],
      )
      .map((message) => message.id)

    if (pendingIds.length === 0) {
      return
    }

    const poll = async (messageId: string) => {
      if (inFlightPollsRef.current.has(messageId)) {
        return
      }

      const nextAttempt = (pollAttemptsRef.current.get(messageId) ?? 0) + 1
      pollAttemptsRef.current.set(messageId, nextAttempt)

      if (nextAttempt > MAX_PENDING_POLL_ATTEMPTS) {
        markPollingTimedOut(messageId)
        return
      }

      inFlightPollsRef.current.add(messageId)
      try {
        const response = await refreshAiChatMessage(messageId)
        setRuntimeMessageState((current) => ({
          ...current,
          [messageId]: {
            status: response.status,
            text: response.content || current[messageId]?.text,
          },
        }))

        if (response.status !== 'pending' && response.status !== 'streaming') {
          pollAttemptsRef.current.delete(messageId)
        } else if (nextAttempt >= MAX_PENDING_POLL_ATTEMPTS) {
          markPollingTimedOut(messageId)
        }
      } catch {
        if (nextAttempt >= MAX_PENDING_POLL_ATTEMPTS) {
          markPollingTimedOut(messageId)
        }
      } finally {
        inFlightPollsRef.current.delete(messageId)
      }
    }

    const timerId = window.setInterval(() => {
      pendingIds.forEach((messageId) => {
        void poll(messageId)
      })
    }, PENDING_POLL_INTERVAL_MS)

    return () => window.clearInterval(timerId)
  }, [messages, retryMessages, runtimeMessageState, pollTimedOutIds])

  const markPollingTimedOut = (messageId: string) => {
    setPollTimedOutIds((current) => ({ ...current, [messageId]: true }))
    setRuntimeMessageState((current) => ({
      ...current,
      [messageId]: {
        status: 'failed',
        text: 'Статус ответа не обновился. Нажмите «Обновить».',
      },
    }))
  }

  const handleRefreshPending = async (messageId: string) => {
    pollAttemptsRef.current.delete(messageId)
    setPollTimedOutIds((current) => {
      const next = { ...current }
      delete next[messageId]
      return next
    })

    try {
      const response = await refreshAiChatMessage(messageId)
      setRuntimeMessageState((current) => ({
        ...current,
        [messageId]: {
          status: response.status,
          text: response.content || current[messageId]?.text,
        },
      }))
    } catch {
      setPollTimedOutIds((current) => ({ ...current, [messageId]: true }))
    }
  }

  const handleRetry = async (message: ResolvedAiChatMessage) => {
    const parentMessageId = message.parentMessageId
    if (!parentMessageId || retryingParentIds[parentMessageId]) {
      return
    }

    setRetryingParentIds((current) => ({ ...current, [parentMessageId]: true }))
    try {
      const response = await retryAiChatMessage(parentMessageId)
      const retryMessage = mapApiMessageToUiMessage(response.message)
      setRetryMessages((current) => {
        if (current.some((item) => item.id === retryMessage.id)) {
          return current
        }
        return [...current, retryMessage]
      })
    } finally {
      setRetryingParentIds((current) => {
        const next = { ...current }
        delete next[parentMessageId]
        return next
      })
    }
  }

  const handleBodyScroll = () => {
    const bodyElement = bodyRef.current
    if (!bodyElement) {
      return
    }

    if (
      bodyElement.scrollTop > 80
      || !hasMoreHistory
      || isHistoryLoading
      || isOlderHistoryLoading
      || isOlderHistoryRequestedRef.current
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
            <span className="ai-assistant-sparkle" aria-hidden="true">✨</span>
            <h2 id="ai-assistant-title">Анна AI</h2>
          </div>

          <button
            className="ai-assistant-close"
            type="button"
            aria-label="Закрыть"
            onClick={handleClose}
          >
            ×
          </button>
        </header>

        <div className="ai-assistant-body" ref={bodyRef} onScroll={handleBodyScroll}>
          {isHistoryLoading ? (
            <div className="ai-assistant-loading-state">
              <div className="ai-assistant-loading-state__icon" aria-hidden="true">✨</div>
              <p>Загружаем историю...</p>
            </div>
          ) : hasMessages ? (
            <>
              {isOlderHistoryLoading && (
                <div className="ai-assistant-older-loading">
                  Загружаем более ранние сообщения...
                </div>
              )}

              {resolvedMessages.map((message, index) => {
                const canRefresh = Boolean(pollTimedOutIds[message.id])
                const canRetry = canRetryMessage(resolvedMessages, message)
                const isRetrying = message.parentMessageId
                  ? Boolean(retryingParentIds[message.parentMessageId])
                  : false

                return (
                  <Fragment key={message.id}>
                    {shouldShowSessionDivider(resolvedMessages, message, index) && (
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
                        <span>{messageStatusLabel(resolvedMessages, message, index, isLoading)}</span>
                      </div>

                      {canRefresh && (
                        <button
                          className="ai-assistant-message__retry"
                          type="button"
                          onClick={() => void handleRefreshPending(message.id)}
                        >
                          Обновить
                        </button>
                      )}

                      {!canRefresh && canRetry && (
                        <button
                          className="ai-assistant-message__retry"
                          type="button"
                          disabled={isRetrying}
                          onClick={() => void handleRetry(message)}
                        >
                          {isRetrying ? 'Повторяем...' : 'Повторить'}
                        </button>
                      )}
                    </div>
                  </Fragment>
                )
              })}

              {isLoading && (
                <div className="ai-assistant-message ai-assistant-message--anna ai-assistant-message--loading">
                  AI анализирует запрос...
                </div>
              )}
            </>
          ) : (
            <div className="ai-assistant-empty-state">
              <div className="ai-assistant-empty-state__icon" aria-hidden="true">✨</div>
              <h3>Начните диалог...</h3>
              <p>Задайте вопрос по CRM, задачам, сделкам, клиентам или базе знаний.</p>
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

function resolveAiChatMessage(
  message: AiChatMessage,
  runtimeState: Record<string, RuntimeMessageState>,
): ResolvedAiChatMessage {
  const remembered = getRememberedAiChatMessage(message.id)
  const runtime = runtimeState[message.id]
  const rememberedText = remembered?.content.trim()

  return {
    ...message,
    text: runtime?.text?.trim() || rememberedText || message.text,
    status:
      runtime?.status
      ?? remembered?.status
      ?? (message.id.startsWith('assistant-error-') ? 'failed' : null),
    parentMessageId: remembered?.parent_message_id ?? null,
  }
}

function mapApiMessageToUiMessage(message: ApiAiChatMessage): AiChatMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.content.trim() || 'Сообщение пока обрабатывается.',
    sessionId: message.session_id,
    createdAt: message.created_at,
  }
}

function groupMessagesForDisplay(messages: ResolvedAiChatMessage[]) {
  const consumed = new Set<string>()
  const result: ResolvedAiChatMessage[] = []

  const attemptsByParent = new Map<string, ResolvedAiChatMessage[]>()
  messages.forEach((message) => {
    if (message.role === 'assistant' && message.parentMessageId) {
      const attempts = attemptsByParent.get(message.parentMessageId) ?? []
      attempts.push(message)
      attemptsByParent.set(message.parentMessageId, attempts)
    }
  })

  attemptsByParent.forEach((attempts) => {
    attempts.sort(compareMessages)
  })

  messages.forEach((message) => {
    if (consumed.has(message.id)) {
      return
    }

    result.push(message)
    consumed.add(message.id)

    const parentId = message.role === 'user' ? message.id : message.parentMessageId
    if (!parentId) {
      return
    }

    const attempts = attemptsByParent.get(parentId) ?? []
    attempts.forEach((attempt) => {
      if (!consumed.has(attempt.id)) {
        result.push(attempt)
        consumed.add(attempt.id)
      }
    })
  })

  return result
}

function compareMessages(left: ResolvedAiChatMessage, right: ResolvedAiChatMessage) {
  const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0
  const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0
  if (leftTime !== rightTime) {
    return leftTime - rightTime
  }
  return left.id.localeCompare(right.id)
}

function canRetryMessage(
  messages: ResolvedAiChatMessage[],
  message: ResolvedAiChatMessage,
) {
  if (
    message.role !== 'assistant'
    || (message.status !== 'failed' && message.status !== 'timeout')
    || !message.parentMessageId
    || message.sessionId !== getCurrentAiChatSessionId()
  ) {
    return false
  }

  const attempts = messages.filter(
    (candidate) =>
      candidate.role === 'assistant'
      && candidate.parentMessageId === message.parentMessageId,
  )

  return attempts[attempts.length - 1]?.id === message.id
}

function shouldShowSessionDivider(
  messages: ResolvedAiChatMessage[],
  message: ResolvedAiChatMessage,
  index: number,
) {
  if (index === 0) {
    return true
  }

  const previousMessage = messages[index - 1]
  return (
    previousMessage.sessionId !== message.sessionId
    || getMessageDateKey(previousMessage.createdAt) !== getMessageDateKey(message.createdAt)
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
  messages: ResolvedAiChatMessage[],
  message: ResolvedAiChatMessage,
  index: number,
  isLoading: boolean,
) {
  if (message.role === 'assistant') {
    if (message.status === 'pending' || message.status === 'streaming') {
      return 'Ответ формируется...'
    }
    if (message.status === 'failed') {
      return 'Ошибка'
    }
    if (message.status === 'timeout') {
      return 'Таймаут'
    }
    return 'Готово'
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
