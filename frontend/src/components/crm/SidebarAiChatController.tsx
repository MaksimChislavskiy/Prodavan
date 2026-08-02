import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AiAssistantModal, type AiChatMessage } from './AiAssistantModal'
import {
  createAiChatSession,
  getAiChatHistory,
  sendAiChatMessage,
  type AiChatContext,
  type ApiAiChatMessage,
} from '../../shared/api/aiChatApi'
import './SidebarAiChatController.css'

function getAiContextFromPath(pathname: string): AiChatContext {
  if (pathname.startsWith('/app/deals')) {
    return { page: 'deals', entity_id: null }
  }

  if (pathname.startsWith('/app/contacts')) {
    return { page: 'contacts', entity_id: null }
  }

  if (pathname.startsWith('/app/tasks')) {
    return { page: 'tasks', entity_id: null }
  }

  if (pathname.startsWith('/app/chats')) {
    return { page: 'chat', entity_id: null }
  }

  if (pathname.startsWith('/app/settings')) {
    return { page: 'settings', entity_id: null }
  }

  return { page: 'dashboard', entity_id: null }
}

function mapApiMessageToAiMessage(message: ApiAiChatMessage): AiChatMessage {
  const text = message.content.trim()

  return {
    id: message.id,
    role: message.role,
    text: text || 'Сообщение пока обрабатывается.',
    sessionId: message.session_id,
    createdAt: message.created_at,
  }
}

export function SidebarAiChatController() {
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isAnswerLoading, setIsAnswerLoading] = useState(false)
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [isOlderHistoryLoading, setIsOlderHistoryLoading] = useState(false)

  useEffect(() => {
    setSidebarTarget(document.querySelector<HTMLElement>('.crm-sidebar'))
  }, [])

  const loadHistory = async () => {
    if (isHistoryLoaded || isHistoryLoading) {
      return
    }

    setIsHistoryLoading(true)

    try {
      const response = await getAiChatHistory(20)
      const historyMessages = [...response.messages]
        .reverse()
        .map(mapApiMessageToAiMessage)

      setMessages(historyMessages)
      setHistoryCursor(response.next_cursor)
      setHasMoreHistory(response.has_more)
      setSessionId(response.messages[0]?.session_id ?? null)
      setIsHistoryLoaded(true)
    } catch (error) {
      setMessages([
        {
          id: 'sidebar-ai-history-load-error',
          role: 'assistant',
          text:
            error instanceof Error
              ? error.message
              : 'Не удалось загрузить историю AI-чата.',
          sessionId: null,
          createdAt: new Date().toISOString(),
        },
      ])
      setHistoryCursor(null)
      setHasMoreHistory(false)
      setIsHistoryLoaded(true)
    } finally {
      setIsHistoryLoading(false)
    }
  }

  const loadOlderHistory = async () => {
    if (
      !hasMoreHistory ||
      !historyCursor ||
      isHistoryLoading ||
      isOlderHistoryLoading
    ) {
      return
    }

    setIsOlderHistoryLoading(true)

    try {
      const response = await getAiChatHistory(20, historyCursor)
      const olderMessages = [...response.messages]
        .reverse()
        .map(mapApiMessageToAiMessage)

      setMessages((currentMessages) => {
        const existingIds = new Set(currentMessages.map((message) => message.id))
        const uniqueOlderMessages = olderMessages.filter(
          (message) => !existingIds.has(message.id),
        )

        return [...uniqueOlderMessages, ...currentMessages]
      })
      setHistoryCursor(response.next_cursor)
      setHasMoreHistory(response.has_more)
    } catch {
      setMessages((currentMessages) => [
        {
          id: `sidebar-ai-older-history-error-${Date.now()}`,
          role: 'assistant',
          text: 'Не удалось загрузить более ранние сообщения.',
          sessionId: null,
          createdAt: new Date().toISOString(),
        },
        ...currentMessages,
      ])
    } finally {
      setIsOlderHistoryLoading(false)
    }
  }

  const sendMessage = async (message: string) => {
    const normalizedMessage = message.trim()

    if (
      !normalizedMessage ||
      isAnswerLoading ||
      isHistoryLoading ||
      isOlderHistoryLoading
    ) {
      return
    }

    const context = getAiContextFromPath(window.location.pathname)
    const localMessageId = `${Date.now()}-${Math.random()}`
    let currentSessionId = sessionId
    let isUserMessageAdded = false

    setIsAnswerLoading(true)

    try {
      if (!currentSessionId) {
        const session = await createAiChatSession(context)
        currentSessionId = session.session_id
        setSessionId(session.session_id)
      }

      const resolvedSessionId = currentSessionId

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `sidebar-user-message-${localMessageId}`,
          role: 'user',
          text: normalizedMessage,
          sessionId: resolvedSessionId,
          createdAt: new Date().toISOString(),
        },
      ])
      isUserMessageAdded = true

      const response = await sendAiChatMessage({
        sessionId: resolvedSessionId,
        message: normalizedMessage,
        context,
      })
      const answerText =
        response.message.content.trim() ||
        'AI не смог сформулировать ответ. Попробуйте переформулировать запрос.'

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: response.message.id,
          role: 'assistant',
          text: answerText,
          sessionId: response.message.session_id,
          createdAt: response.message.created_at,
        },
      ])
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        ...(
          isUserMessageAdded
            ? []
            : [
                {
                  id: `sidebar-user-message-${localMessageId}`,
                  role: 'user' as const,
                  text: normalizedMessage,
                  sessionId: currentSessionId,
                  createdAt: new Date().toISOString(),
                },
              ]
        ),
        {
          id: `sidebar-assistant-error-${localMessageId}`,
          role: 'assistant',
          text:
            error instanceof Error
              ? error.message
              : 'Не удалось получить ответ. Повторите попытку позже.',
          sessionId: currentSessionId,
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setIsAnswerLoading(false)
    }
  }

  const openAssistant = () => {
    setIsOpen(true)
    void loadHistory()
  }

  return (
    <>
      {sidebarTarget &&
        createPortal(
          <button
            className="crm-sidebar-ai-chat-button"
            type="button"
            aria-haspopup="dialog"
            onClick={openAssistant}
          >
            Чат с AI
          </button>,
          sidebarTarget,
        )}

      {isOpen && (
        <AiAssistantModal
          messages={messages}
          isLoading={isAnswerLoading}
          isHistoryLoading={isHistoryLoading}
          isOlderHistoryLoading={isOlderHistoryLoading}
          hasMoreHistory={hasMoreHistory}
          onLoadOlderHistory={() => {
            void loadOlderHistory()
          }}
          onSendMessage={(message) => {
            void sendMessage(message)
          }}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
