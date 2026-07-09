import { useEffect, useState } from 'react'
import logoFull from '../../assets/brand/logo-full.svg'
import { DashboardPage } from './DashboardPage'
import { AiAssistantModal, type AiChatMessage } from './AiAssistantModal'
import {
  createAiChatSession,
  getAiChatHistory,
  sendAiChatMessage,
  type AiChatContext,
  type ApiAiChatMessage,
} from '../../shared/api/aiChatApi'
import './CrmLayout.css'

type SidebarIconName =
  | 'ai'
  | 'dashboard'
  | 'deals'
  | 'contacts'
  | 'tasks'
  | 'settings'
  | 'chat'

type CrmSectionId =
  | 'dashboard'
  | 'ai'
  | 'deals'
  | 'contacts'
  | 'tasks'
  | 'settings'
  | 'chat'

type NavigationItem = {
  id: CrmSectionId
  label: string
  icon: SidebarIconName
  href: string
  variant?: 'ai'
}

type CrmSection = {
  title: string
  eyebrow: string
  text: string
  widgets: {
    value: string
    label: string
  }[]
}

const navigationItems: NavigationItem[] = [
  { id: 'ai', label: 'AI', icon: 'ai', href: '/app/ai', variant: 'ai' },
  { id: 'dashboard', label: 'Рабочий стол', icon: 'dashboard', href: '/app' },
  { id: 'deals', label: 'Сделки', icon: 'deals', href: '/app/deals' },
  { id: 'contacts', label: 'Контакты', icon: 'contacts', href: '/app/contacts' },
  { id: 'tasks', label: 'Задачи', icon: 'tasks', href: '/app/tasks' },
  { id: 'settings', label: 'Настройки', icon: 'settings', href: '/app/settings/ai' },
  { id: 'chat', label: 'Чат', icon: 'chat', href: '/app/chats' },
]

const crmSections: Record<CrmSectionId, CrmSection> = {
  dashboard: {
    eyebrow: 'CRM',
    title: 'Рабочий стол',
    text:
      'Это первая заглушка рабочего стола. Позже здесь появятся задачи на сегодня, онбординг и реальные данные из API.',
    widgets: [
      { value: '0', label: 'Задач на сегодня' },
      { value: '0', label: 'Просрочено' },
      { value: '—', label: 'AI пока без API' },
    ],
  },
  ai: {
    eyebrow: 'AI',
    title: 'AI-помощник',
    text:
      'Здесь позже появится интерфейс AI-помощника: быстрые запросы, история диалогов и ответы на основе данных CRM.',
    widgets: [
      { value: '0', label: 'Запросов сегодня' },
      { value: '0', label: 'Ответов AI' },
      { value: 'mock', label: 'Режим без API' },
    ],
  },
  deals: {
    eyebrow: 'CRM',
    title: 'Сделки',
    text:
      'Здесь позже появится канбан-доска сделок: этапы продаж, карточки сделок, создание и перемещение между колонками.',
    widgets: [
      { value: '0', label: 'Активных сделок' },
      { value: '0 ₽', label: 'Сумма в работе' },
      { value: 'mock', label: 'Канбан позже' },
    ],
  },
  contacts: {
    eyebrow: 'CRM',
    title: 'Контакты',
    text:
      'Здесь позже появится список клиентов и карточки контактов: имя, компания, телефон, e-mail и Telegram.',
    widgets: [
      { value: '0', label: 'Контактов' },
      { value: '0', label: 'Компаний' },
      { value: 'mock', label: 'Данные позже' },
    ],
  },
  tasks: {
    eyebrow: 'CRM',
    title: 'Задачи',
    text:
      'Здесь позже появится раздел задач: статусы, сроки, карточки задач и управление действиями менеджера.',
    widgets: [
      { value: '0', label: 'Новых задач' },
      { value: '0', label: 'В работе' },
      { value: '0', label: 'Завершено' },
    ],
  },
  settings: {
    eyebrow: 'CRM',
    title: 'Настройки AI',
    text:
      'Здесь позже появятся настройки AI: инструкция, автопилот, база знаний и полезные материалы.',
    widgets: [
      { value: 'off', label: 'Автопилот' },
      { value: '0', label: 'Документов' },
      { value: 'mock', label: 'Настройки позже' },
    ],
  },
  chat: {
    eyebrow: 'CRM',
    title: 'Чат',
    text:
      'Здесь позже появится единое окно переписок с клиентами и возможность подключать AI к диалогам.',
    widgets: [
      { value: '0', label: 'Диалогов' },
      { value: '0', label: 'Новых сообщений' },
      { value: 'mock', label: 'Чат позже' },
    ],
  },
}

function getSectionFromPath(pathname: string): CrmSectionId {
  if (pathname === '/app/ai') {
    return 'ai'
  }

  if (pathname === '/app/deals') {
    return 'deals'
  }

  if (pathname === '/app/contacts') {
    return 'contacts'
  }

  if (pathname === '/app/tasks') {
    return 'tasks'
  }

  if (pathname === '/app/settings/ai') {
    return 'settings'
  }

  if (pathname === '/app/chats') {
    return 'chat'
  }

  return 'dashboard'
}

function SidebarIcon({ name }: { name: SidebarIconName }) {
  if (name === 'ai') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M15.7 3.5c-6.4 0-11.4 5.1-11.4 11.3 0 3.2 1.3 6.1 3.5 8.2v4.8c0 .6.5 1.1 1.1 1.1h7.4c.6 0 1.1-.5 1.1-1.1v-2.4h2.8c2.2 0 4-1.8 4-4v-2.2h1.9c.8 0 1.3-.9.9-1.6l-2.8-4.7C23.3 7.4 20 3.5 15.7 3.5Zm0 2.5c3.2 0 5.6 3.1 6.3 7.8l.1.3 2 3.3h-1.2c-.7 0-1.2.5-1.2 1.2v2.8c0 .8-.7 1.5-1.5 1.5h-4c-.7 0-1.2.5-1.2 1.2v2.3H10.3v-4c0-.4-.2-.7-.5-.9-1.9-1.6-3-4-3-6.6C6.8 10 10.8 6 15.7 6Z" />
        <path d="M16.1 6.7c.7 0 1.2.5 1.2 1.2v1.2a3.2 3.2 0 0 1 2 2h1.2a1.2 1.2 0 1 1 0 2.4h-1.2a3.2 3.2 0 0 1-2 2v2.2a3.2 3.2 0 1 1-2.4 0v-2.2a3.2 3.2 0 0 1-2-2h-1.2a1.2 1.2 0 0 1 0-2.4h1.2a3.2 3.2 0 0 1 2-2V7.9c0-.7.5-1.2 1.2-1.2Zm0 4.5a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Zm0 8.8a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z" />
      </svg>
    )
  }

  if (name === 'dashboard') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M5 14.6 16 5l11 9.6v12.2a1.2 1.2 0 0 1-1.2 1.2h-6.2a1.2 1.2 0 0 1-1.2-1.2v-6.5h-4.8v6.5a1.2 1.2 0 0 1-1.2 1.2H6.2A1.2 1.2 0 0 1 5 26.8V14.6Zm2.5 1.1v9.8h3.6V19c0-.7.5-1.2 1.2-1.2h7.4c.7 0 1.2.5 1.2 1.2v6.5h3.6v-9.8L16 8.3l-8.5 7.4Z" />
      </svg>
    )
  }

  if (name === 'deals') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M12.4 8.3 15 10l-4.6 4.6a3 3 0 0 0 4.2 4.2l1.5-1.5 5.6 5.6a2.8 2.8 0 0 0 4-4l-.4-.4.7-.7a2.8 2.8 0 0 0 0-4l-5.5-5.5a6 6 0 0 0-7.8-.5l-.3.5Zm-2.2 1.2-1.7-.9a1.2 1.2 0 0 0-1.6.5l-3.3 6.1a1.2 1.2 0 0 0 .5 1.7l4.2 2.2a1.2 1.2 0 0 0 1.6-.5l.8-1.5 1.4 1.4a5.5 5.5 0 0 0 7.8 7.8l.5.5a5.2 5.2 0 0 0 7.4-7.4l-.3-.3.2-.2a5.2 5.2 0 0 0 0-7.4l-5.5-5.5a8.5 8.5 0 0 0-12 .2Zm3.4.8a3.6 3.6 0 0 1 5.1 0l5.5 5.5a.4.4 0 0 1 0 .6l-1.6 1.6-6.5-6.5-3.3 3.3a.6.6 0 1 1-.9-.9l1.7-3.6ZM7.1 11.3l1.9 1-1.7 3.3-1.9-1 1.7-3.3Zm7.8 7.7 3.3 3.3a3 3 0 0 1-4.2-4.2l.9.9Z" />
      </svg>
    )
  }

  if (name === 'contacts') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M12.2 15.7a5.7 5.7 0 1 1 0-11.4 5.7 5.7 0 0 1 0 11.4Zm0-8.9a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm13 9.6a4.8 4.8 0 1 1 0-9.6 4.8 4.8 0 0 1 0 9.6Zm0-7.1a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6ZM2.8 28.4a1.2 1.2 0 0 1-1.2-1.2c0-5.4 4.7-9.8 10.6-9.8s10.6 4.4 10.6 9.8a1.2 1.2 0 1 1-2.5 0c0-4-3.6-7.3-8.1-7.3s-8.1 3.3-8.1 7.3a1.2 1.2 0 0 1-1.3 1.2Zm21.1-2.7a1.2 1.2 0 0 1-.4-2.4 6.6 6.6 0 0 1 1.7-.2c3 0 5.5 1.8 5.5 4.1a1.2 1.2 0 1 1-2.5 0c0-.8-1.2-1.6-3-1.6-.4 0-.7 0-1 .1h-.3Z" />
      </svg>
    )
  }

  if (name === 'tasks') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M8 5h18.5A1.5 1.5 0 0 1 28 6.5v19A1.5 1.5 0 0 1 26.5 27H15a1.2 1.2 0 1 1 0-2.5h10.5v-17H8v8a1.2 1.2 0 1 1-2.5 0v-9A1.5 1.5 0 0 1 7 5h1Zm8.7 10.1a1.2 1.2 0 0 1 0 1.8l-8.2 8.2a1.2 1.2 0 0 1-1.8 0l-3.4-3.4a1.3 1.3 0 0 1 1.8-1.8l2.5 2.5 7.3-7.3a1.2 1.2 0 0 1 1.8 0Z" />
      </svg>
    )
  }

  if (name === 'settings') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M18.1 2.8a1.2 1.2 0 0 1 1 .8l1 3a10.4 10.4 0 0 1 1.8 1l3.1-.7a1.2 1.2 0 0 1 1.2.5l2.1 3.7a1.2 1.2 0 0 1-.2 1.3l-2.1 2.3a10.7 10.7 0 0 1 0 2.1l2.1 2.3c.4.4.4 1 .2 1.4l-2.1 3.7a1.2 1.2 0 0 1-1.2.5l-3.1-.7c-.6.4-1.2.8-1.8 1.1l-1 3a1.2 1.2 0 0 1-1 .8h-4.2a1.2 1.2 0 0 1-1-.8l-1-3a10.4 10.4 0 0 1-1.8-1.1l-3.1.7a1.2 1.2 0 0 1-1.2-.5l-2.1-3.7a1.2 1.2 0 0 1 .2-1.4L6 16.8a10.7 10.7 0 0 1 0-2.1l-2.1-2.3a1.2 1.2 0 0 1-.2-1.3l2.1-3.7A1.2 1.2 0 0 1 7 6.9l3.1.7c.6-.4 1.2-.8 1.8-1l1-3a1.2 1.2 0 0 1 1-.8h4.2Zm-.9 2.5h-2.4l-.9 2.7c-.1.4-.4.7-.8.8-.8.3-1.5.7-2.1 1.2-.3.3-.8.4-1.2.3l-2.8-.6-1.2 2.1 1.9 2.1c.3.3.4.7.3 1.1a8 8 0 0 0 0 2.1c.1.4 0 .8-.3 1.1l-1.9 2.1 1.2 2.1 2.8-.6c.4-.1.9 0 1.2.3.6.5 1.3.9 2.1 1.2.4.1.7.4.8.8l.9 2.7h2.4l.9-2.7c.1-.4.4-.7.8-.8.8-.3 1.5-.7 2.1-1.2.3-.3.8-.4 1.2-.3l2.8.6 1.2-2.1-1.9-2.1c-.3-.3-.4-.7-.3-1.1a8 8 0 0 0 0-2.1c-.1-.4 0-.8.3-1.1l1.9-2.1-1.2-2.1-2.8.6c-.4.1-.9 0-1.2-.3a8 8 0 0 0-2.1-1.2c-.4-.1-.7-.4-.8-.8l-.9-2.7ZM16 11.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Zm0 2.5a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M11.5 5.2C6.3 5.2 2.2 8.9 2.2 13.4c0 2.2 1 4.1 2.6 5.6l-.9 4a1.2 1.2 0 0 0 1.7 1.3l4.6-2.1c.4.1.9.1 1.3.1 5.2 0 9.3-3.7 9.3-8.2s-4.1-8.9-9.3-8.9Zm0 2.5c3.8 0 6.8 2.6 6.8 5.7s-3 5.7-6.8 5.7c-.5 0-1 0-1.5-.2-.3-.1-.6 0-.9.1l-2.2 1 .4-1.8c.1-.5 0-.9-.4-1.2a5 5 0 0 1-2.2-3.7c0-3 3-5.6 6.8-5.6Zm9.1 2.5c5.2 0 9.2 3.7 9.2 8.2 0 2.2-1 4.1-2.6 5.6l.9 4a1.2 1.2 0 0 1-1.7 1.3l-4.6-2.1c-.4.1-.8.1-1.3.1-3.4 0-6.3-1.5-7.9-3.8 1-.1 1.9-.4 2.8-.8 1.2 1.3 3 2.1 5.1 2.1.5 0 1 0 1.5-.2.3-.1.6 0 .9.1l2.2 1-.4-1.8c-.1-.5 0-.9.4-1.2a5 5 0 0 0 2.2-3.7c0-3.1-3-5.7-6.8-5.7h-.4c-.1-.9-.4-1.7-.8-2.5.4-.1.8-.1 1.2-.1Z" />
    </svg>
  )
}

export function CrmLayout() {
  const [activeSection, setActiveSection] = useState<CrmSectionId>(() =>
    getSectionFromPath(window.location.pathname),
  )
  const [isAiAssistantOpen, setIsAiAssistantOpen] = useState(false)
  const [aiSearchQuery, setAiSearchQuery] = useState('')
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([])
  const [aiSessionId, setAiSessionId] = useState<string | null>(null)
  const [isAiAnswerLoading, setIsAiAnswerLoading] = useState(false)
  const [isAiHistoryLoaded, setIsAiHistoryLoaded] = useState(false)
  const [isAiHistoryLoading, setIsAiHistoryLoading] = useState(false)

  const currentSection = crmSections[activeSection]

  const getAiContext = (): AiChatContext => {
    if (activeSection === 'ai') {
      return {
        page: 'dashboard',
        entity_id: null,
      }
    }

    if (activeSection === 'settings') {
      return {
        page: 'settings',
        entity_id: null,
      }
    }

    if (activeSection === 'chat') {
      return {
        page: 'chat',
        entity_id: null,
      }
    }

    return {
      page: activeSection,
      entity_id: null,
    }
  }

  useEffect(() => {
    const handlePopState = () => {
      setActiveSection(getSectionFromPath(window.location.pathname))
      window.scrollTo(0, 0)
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  const mapApiMessageToAiMessage = (message: ApiAiChatMessage): AiChatMessage => {
    const text = message.content.trim()

    return {
      id: message.id,
      role: message.role,
      text: text || 'Сообщение пока обрабатывается.',
    }
  }

  const loadAiHistory = async (): Promise<string | null> => {
    if (isAiHistoryLoaded || isAiHistoryLoading) {
      return aiSessionId
    }

    if (aiMessages.length > 0) {
      setIsAiHistoryLoaded(true)
      return aiSessionId
    }

    setIsAiHistoryLoading(true)

    try {
      const response = await getAiChatHistory(20)

      const historyMessages = [...response.messages]
        .reverse()
        .map(mapApiMessageToAiMessage)

      setAiMessages(historyMessages)

      const latestSessionId = response.messages[0]?.session_id ?? null

      if (latestSessionId) {
        setAiSessionId(latestSessionId)
      }

      setIsAiHistoryLoaded(true)

      return latestSessionId
    } catch (error) {
      setAiMessages([
        {
          id: 'ai-history-load-error',
          role: 'assistant',
          text: error instanceof Error
            ? error.message
            : 'Не удалось загрузить историю AI-чата.',
        },
      ])

      setIsAiHistoryLoaded(true)

      return null
    } finally {
      setIsAiHistoryLoading(false)
    }
  }

  const sendAiMessage = async (message: string, sessionIdOverride?: string | null) => {
    const normalizedMessage = message.trim()

    if (!normalizedMessage || isAiAnswerLoading || isAiHistoryLoading) {
      return
    }

    const context = getAiContext()
    const localMessageId = `${Date.now()}-${Math.random()}`

    setAiMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `user-message-${localMessageId}`,
        role: 'user',
        text: normalizedMessage,
      },
    ])

    setIsAiAnswerLoading(true)

    try {
      let currentSessionId = sessionIdOverride ?? aiSessionId

      if (!currentSessionId) {
        const session = await createAiChatSession(context)
        currentSessionId = session.session_id
        setAiSessionId(session.session_id)
      }

      const response = await sendAiChatMessage({
        sessionId: currentSessionId,
        message: normalizedMessage,
        context,
      })

      const answerText = response.message.content.trim()
        || 'AI не смог сформулировать ответ. Попробуйте переформулировать запрос.'

      setAiMessages((currentMessages) => [
        ...currentMessages,
        {
          id: response.message.id,
          role: 'assistant',
          text: answerText,
        },
      ])
    } catch (error) {
      setAiMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `assistant-error-${localMessageId}`,
          role: 'assistant',
          text: error instanceof Error
            ? error.message
            : 'Не удалось получить ответ. Повторите попытку позже.',
        },
      ])
    } finally {
      setIsAiAnswerLoading(false)
    }
  }

  const openAiAssistant = (prompt = '') => {
    const normalizedPrompt = prompt.trim()

    setIsAiAssistantOpen(true)

    if (normalizedPrompt) {
      void (async () => {
        const historySessionId = await loadAiHistory()
        await sendAiMessage(normalizedPrompt, historySessionId)
      })()

      return
    }

    void loadAiHistory()
  }

  const openSection = (href: string) => {
    if (href === '/app/ai') {
      openAiAssistant()
      return
    }

    window.history.pushState(null, '', href)
    setActiveSection(getSectionFromPath(href))
    window.scrollTo(0, 0)
  }

  return (
    <div className="crm-shell">
      <aside className="crm-sidebar" aria-label="Основное меню CRM">
        <a className="crm-sidebar__logo" href="/app" aria-label="Продаван CRM">
          <img src={logoFull} alt="Продаван" />
        </a>

        <nav className="crm-sidebar__nav">
          {navigationItems.map((item) => {
            const isActive = item.id === activeSection

            return (
              <a
                className={[
                  'crm-sidebar__link',
                  item.variant === 'ai' ? 'crm-sidebar__link--ai' : '',
                  isActive ? 'crm-sidebar__link--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                href={item.href}
                key={item.label}
                aria-current={isActive ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  openSection(item.href)
                }}
              >
                <span className="crm-sidebar__icon">
                  <SidebarIcon name={item.icon} />
                </span>
                <span>{item.label}</span>
              </a>
            )
          })}
        </nav>
      </aside>

      <div className="crm-main">
        <header className="crm-topbar">
          <form
            className="crm-ai-search"
            onSubmit={(event) => {
              event.preventDefault()
              openAiAssistant(aiSearchQuery)
              setAiSearchQuery('')
            }}
          >
            <span className="crm-ai-search__icon" aria-hidden="true">
              ✨
            </span>
            <input
              className="crm-ai-search__input"
              type="text"
              placeholder="Спросите AI"
              aria-label="Спросить AI"
              maxLength={200}
              value={aiSearchQuery}
              onChange={(event) => setAiSearchQuery(event.target.value)}
            />
            <button className="crm-ai-search__button" type="submit" aria-label="Отправить запрос AI">
              ↵
            </button>
          </form>

          <div className="crm-topbar__actions">
            <button className="crm-icon-button" type="button" aria-label="Уведомления">
              🔔
              <span className="crm-icon-button__badge">3</span>
            </button>

            <button className="crm-profile-button" type="button" aria-label="Меню профиля">
              <span className="crm-profile-button__avatar">М</span>
              <span className="crm-profile-button__name">Максим</span>
            </button>
          </div>
        </header>

        <main className="crm-content">
          {activeSection === 'dashboard' ? (
            <DashboardPage />
          ) : (
            <>
              <section className="crm-hero-card">
                <p className="crm-hero-card__eyebrow">{currentSection.eyebrow}</p>
                <h1 className="crm-hero-card__title">{currentSection.title}</h1>
                <p className="crm-hero-card__text">{currentSection.text}</p>
              </section>

              <section className="crm-widgets" aria-label={`Заглушки раздела ${currentSection.title}`}>
                {currentSection.widgets.map((widget) => (
                  <article className="crm-widget" key={widget.label}>
                    <span className="crm-widget__value">{widget.value}</span>
                    <span className="crm-widget__label">{widget.label}</span>
                  </article>
                ))}
              </section>
            </>
          )}
        </main>

        {isAiAssistantOpen && (
          <AiAssistantModal
            messages={aiMessages}
            isLoading={isAiAnswerLoading}
            isHistoryLoading={isAiHistoryLoading}
            onSendMessage={(message) => {
              void sendAiMessage(message)
            }}
            onClose={() => setIsAiAssistantOpen(false)}
          />
        )}
      </div>
    </div>
  )
}