import { useEffect, useState } from 'react'
import logoFull from '../../assets/brand/logo-full.svg'
import { DashboardPage } from './DashboardPage'
import { AiSettingsPage } from './AiSettingsPage'
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

type PlaceholderSectionId = Exclude<CrmSectionId, 'dashboard' | 'ai'>

type NavigationItem = {
  id: CrmSectionId
  label: string
  icon: SidebarIconName
  href: string
  variant?: 'ai'
}

type CrmPlaceholderSection = {
  title: string
  eyebrow: string
  text: string
  widgets: {
    value: string
    label: string
  }[]
}

const navigationItems: NavigationItem[] = [
  { id: 'ai', label: 'AI', icon: 'ai', href: '/app/settings/ai', variant: 'ai' },
  { id: 'dashboard', label: 'Рабочий стол', icon: 'dashboard', href: '/app' },
  { id: 'deals', label: 'Сделки', icon: 'deals', href: '/app/deals' },
  { id: 'contacts', label: 'Контакты', icon: 'contacts', href: '/app/contacts' },
  { id: 'tasks', label: 'Задачи', icon: 'tasks', href: '/app/tasks' },
  { id: 'settings', label: 'Настройки', icon: 'settings', href: '/app/settings' },
  { id: 'chat', label: 'Чат', icon: 'chat', href: '/app/chats' },
]

const placeholderSections: Record<PlaceholderSectionId, CrmPlaceholderSection> = {
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
    title: 'Настройки',
    text:
      'Здесь позже появятся общие настройки аккаунта, команды, уведомлений, интеграций и доступа.',
    widgets: [
      { value: 'mock', label: 'Профиль' },
      { value: 'mock', label: 'Команда' },
      { value: 'mock', label: 'Интеграции' },
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
  if (pathname === '/app/ai' || pathname === '/app/settings/ai') {
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

  if (pathname === '/app/settings') {
    return 'settings'
  }

  if (pathname === '/app/chats') {
    return 'chat'
  }

  return 'dashboard'
}

function SidebarIcon({ name }: { name: SidebarIconName }) {
  const icons: Record<SidebarIconName, string> = {
    ai: 'AI',
    dashboard: '⌂',
    deals: '▦',
    contacts: '◉',
    tasks: '✓',
    settings: '⚙',
    chat: '✉',
  }

  return <span aria-hidden="true">{icons[name]}</span>
}

function isPlaceholderSection(section: CrmSectionId): section is PlaceholderSectionId {
  return section !== 'dashboard' && section !== 'ai'
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
  const [aiHistoryCursor, setAiHistoryCursor] = useState<string | null>(null)
  const [hasMoreAiHistory, setHasMoreAiHistory] = useState(false)
  const [isAiOlderHistoryLoading, setIsAiOlderHistoryLoading] = useState(false)

  const getAiContext = (): AiChatContext => {
    if (activeSection === 'ai' || activeSection === 'settings') {
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
      sessionId: message.session_id,
      createdAt: message.created_at,
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
      setAiHistoryCursor(response.next_cursor)
      setHasMoreAiHistory(response.has_more)

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
          sessionId: null,
          createdAt: new Date().toISOString(),
        },
      ])

      setIsAiHistoryLoaded(true)
      setAiHistoryCursor(null)
      setHasMoreAiHistory(false)

      return null
    } finally {
      setIsAiHistoryLoading(false)
    }
  }

  const loadOlderAiHistory = async () => {
    if (
      !hasMoreAiHistory ||
      !aiHistoryCursor ||
      isAiHistoryLoading ||
      isAiOlderHistoryLoading
    ) {
      return
    }

    setIsAiOlderHistoryLoading(true)

    try {
      const response = await getAiChatHistory(20, aiHistoryCursor)

      const olderMessages = [...response.messages]
        .reverse()
        .map(mapApiMessageToAiMessage)

      setAiMessages((currentMessages) => {
        const existingMessageIds = new Set(currentMessages.map((message) => message.id))
        const uniqueOlderMessages = olderMessages.filter(
          (message) => !existingMessageIds.has(message.id),
        )

        return [...uniqueOlderMessages, ...currentMessages]
      })

      setAiHistoryCursor(response.next_cursor)
      setHasMoreAiHistory(response.has_more)
    } catch {
      setAiMessages((currentMessages) => [
        {
          id: `ai-older-history-load-error-${Date.now()}`,
          role: 'assistant',
          text: 'Не удалось загрузить более ранние сообщения.',
          sessionId: null,
          createdAt: new Date().toISOString(),
        },
        ...currentMessages,
      ])
    } finally {
      setIsAiOlderHistoryLoading(false)
    }
  }

  const sendAiMessage = async (
    message: string,
    sessionIdOverride?: string | null,
    forceNewSession = false,
  ) => {
    const normalizedMessage = message.trim()

    if (
      !normalizedMessage ||
      isAiAnswerLoading ||
      isAiHistoryLoading ||
      isAiOlderHistoryLoading
    ) {
      return
    }

    const context = getAiContext()
    const localMessageId = `${Date.now()}-${Math.random()}`
    let currentSessionId = forceNewSession ? null : sessionIdOverride ?? aiSessionId
    let isUserMessageAdded = false

    setIsAiAnswerLoading(true)

    try {
      if (!currentSessionId) {
        const session = await createAiChatSession(context)
        currentSessionId = session.session_id
        setAiSessionId(session.session_id)
      }

      setAiMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `user-message-${localMessageId}`,
          role: 'user',
          text: normalizedMessage,
          sessionId: currentSessionId,
          createdAt: new Date().toISOString(),
        },
      ])

      isUserMessageAdded = true

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
          sessionId: response.message.session_id,
          createdAt: response.message.created_at,
        },
      ])
    } catch (error) {
      setAiMessages((currentMessages) => [
        ...currentMessages,
        ...(
          isUserMessageAdded
            ? []
            : [
                {
                  id: `user-message-${localMessageId}`,
                  role: 'user' as const,
                  text: normalizedMessage,
                  sessionId: currentSessionId,
                  createdAt: new Date().toISOString(),
                },
              ]
        ),
        {
          id: `assistant-error-${localMessageId}`,
          role: 'assistant',
          text: error instanceof Error
            ? error.message
            : 'Не удалось получить ответ. Повторите попытку позже.',
          sessionId: currentSessionId,
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setIsAiAnswerLoading(false)
    }
  }

  const openAiAssistant = (prompt = '') => {
    const normalizedPrompt = prompt.trim()

    if (!normalizedPrompt) {
      return
    }

    setIsAiAssistantOpen(true)

    void (async () => {
      await loadAiHistory()
      await sendAiMessage(normalizedPrompt, null, true)
    })()
  }

  const openSection = (href: string) => {
    window.history.pushState(null, '', href)
    setActiveSection(getSectionFromPath(href))
    window.scrollTo(0, 0)
  }

  const renderContent = () => {
    if (activeSection === 'dashboard') {
      return <DashboardPage />
    }

    if (activeSection === 'ai') {
      return <AiSettingsPage />
    }

    if (!isPlaceholderSection(activeSection)) {
      return null
    }

    const currentSection = placeholderSections[activeSection]

    return (
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
    )
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

              const normalizedQuery = aiSearchQuery.trim()

              if (!normalizedQuery) {
                return
              }

              openAiAssistant(normalizedQuery)
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

        <main className="crm-content">{renderContent()}</main>

        {isAiAssistantOpen && (
          <AiAssistantModal
            messages={aiMessages}
            isLoading={isAiAnswerLoading}
            isHistoryLoading={isAiHistoryLoading}
            isOlderHistoryLoading={isAiOlderHistoryLoading}
            hasMoreHistory={hasMoreAiHistory}
            onLoadOlderHistory={() => {
              void loadOlderAiHistory()
            }}
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
