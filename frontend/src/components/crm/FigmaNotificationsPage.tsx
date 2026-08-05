import { useEffect, useState, type UIEvent } from 'react'
import {
  deleteNotification,
  getNotifications,
  markNotificationRead,
  type ApiNotification,
} from '../../shared/api/notificationsApi'
import {
  getTelegramSettings,
  type ApiWorkspaceIntegration,
} from '../../shared/api/workspaceSettingsApi'
import {
  readNotificationPreferences,
  writeNotificationPreferences,
  type NotificationPreferences,
} from '../../shared/notificationPreferences'

type FigmaNotificationsPageProps = {
  unreadCount: number
  realtimeVersion: number
  onUnreadCountChange: (count: number) => void
  onNavigate: (href: string) => void
}

type PageState = 'loading' | 'ready' | 'error'
type NotificationTone = 'critical' | 'warning' | 'success'
type TabId = 'center' | 'settings'
type TelegramLoadState = 'loading' | 'ready' | 'error'

function formatNotificationDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)

  if (isToday) {
    return `Сегодня, ${time}`
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getNotificationCategory(notification: ApiNotification) {
  const searchableValue = `${notification.type} ${notification.entity_type}`.toLowerCase()

  if (searchableValue.includes('task')) {
    return 'Задача'
  }

  if (searchableValue.includes('deal')) {
    return 'Сделка'
  }

  if (searchableValue.includes('contact')) {
    return 'Контакт'
  }

  if (
    searchableValue.includes('chat') ||
    searchableValue.includes('message') ||
    searchableValue.includes('telegram')
  ) {
    return 'Чат'
  }

  if (searchableValue.includes('ai')) {
    return 'AI'
  }

  return 'Система'
}

function isChatNotification(notification: ApiNotification) {
  const searchableValue = [
    notification.type,
    notification.entity_type,
    notification.title,
    notification.content,
  ]
    .join(' ')
    .toLowerCase()

  return (
    searchableValue.includes('chat') ||
    searchableValue.includes('message') ||
    searchableValue.includes('telegram') ||
    searchableValue.includes('сообщен')
  )
}

function getNotificationTone(notification: ApiNotification): NotificationTone {
  const searchableValue = [notification.type, notification.title, notification.content]
    .join(' ')
    .toLowerCase()

  if (
    searchableValue.includes('overdue') ||
    searchableValue.includes('failed') ||
    searchableValue.includes('critical') ||
    searchableValue.includes('limit') ||
    searchableValue.includes('просроч') ||
    searchableValue.includes('критичес') ||
    searchableValue.includes('ошиб')
  ) {
    return 'critical'
  }

  if (
    searchableValue.includes('created') ||
    searchableValue.includes('added') ||
    searchableValue.includes('completed') ||
    searchableValue.includes('success') ||
    searchableValue.includes('создан') ||
    searchableValue.includes('добавлен') ||
    searchableValue.includes('готов')
  ) {
    return 'success'
  }

  if (!notification.is_read) {
    return 'critical'
  }

  return 'warning'
}

function getStatusText(notification: ApiNotification, tone: NotificationTone) {
  const searchableValue = `${notification.type} ${notification.title} ${notification.content}`.toLowerCase()

  if (searchableValue.includes('overdue') || searchableValue.includes('просроч')) {
    return 'просрочено'
  }

  if (tone === 'critical') {
    return 'Срочно!'
  }

  return formatNotificationDate(notification.created_at)
}

function getRelatedObjectText(notification: ApiNotification) {
  const category = getNotificationCategory(notification).toLowerCase()

  if (notification.entity_id) {
    return `Связанный объект: ${category} ${notification.entity_id}`
  }

  return `Связанный объект: ${category}`
}

function getChannelText(notification: ApiNotification) {
  const searchableValue = `${notification.type} ${notification.title} ${notification.content}`.toLowerCase()

  return searchableValue.includes('telegram')
    ? 'Чат: Telegram'
    : `Чат: ${getNotificationCategory(notification)}`
}

function Toggle({
  checked,
  label,
  onChange,
  disabled = false,
  title,
}: {
  checked: boolean
  label: string
  onChange?: (checked: boolean) => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      className={`figma-notification-toggle ${checked ? 'figma-notification-toggle--active' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={title}
      onClick={() => onChange?.(!checked)}
    >
      <span />
    </button>
  )
}

export function FigmaNotificationsPage({
  unreadCount,
  realtimeVersion,
  onUnreadCountChange,
  onNavigate,
}: FigmaNotificationsPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>('center')
  const [pageState, setPageState] = useState<PageState>('loading')
  const [notifications, setNotifications] = useState<ApiNotification[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => {
    const storedPreferences = readNotificationPreferences()

    if (
      !('Notification' in window) ||
      window.Notification.permission !== 'granted'
    ) {
      return { browserEnabled: false }
    }

    return storedPreferences
  })
  const [telegramIntegration, setTelegramIntegration] =
    useState<ApiWorkspaceIntegration | null>(null)
  const [telegramLoadState, setTelegramLoadState] =
    useState<TelegramLoadState>('loading')

  const allLoadedSelected =
    notifications.length > 0 && notifications.every((item) => selectedIds.has(item.id))
  const browserNotificationsSupported = 'Notification' in window
  const browserNotificationsDenied =
    browserNotificationsSupported && window.Notification.permission === 'denied'
  const telegramConnected = telegramIntegration?.status === 'connected'

  const telegramTitle = (() => {
    if (telegramLoadState === 'loading') {
      return 'Загружаем состояние Telegram из backend.'
    }

    if (telegramLoadState === 'error') {
      return 'Не удалось получить состояние Telegram из backend.'
    }

    if (telegramConnected) {
      const botName = telegramIntegration?.bot_username
        ? ` ${telegramIntegration.bot_username}`
        : ''

      return `Telegram-бот${botName} подключён. Отдельной настройки дублирования уведомлений backend не предоставляет.`
    }

    return 'Telegram-бот не подключён. Подключение выполняется в основном разделе «Настройки».'
  })()

  const browserTitle = (() => {
    if (!browserNotificationsSupported) {
      return 'Этот браузер не поддерживает системные уведомления.'
    }

    if (browserNotificationsDenied) {
      return 'Уведомления запрещены в настройках браузера.'
    }

    return 'Показывает системные уведомления из событий backend, пока CRM открыта в браузере.'
  })()

  useEffect(() => {
    writeNotificationPreferences(preferences)
  }, [preferences])

  useEffect(() => {
    let isMounted = true

    getTelegramSettings()
      .then((response) => {
        if (!isMounted) {
          return
        }

        setTelegramIntegration(response.integration)
        setTelegramLoadState('ready')
      })
      .catch(() => {
        if (isMounted) {
          setTelegramLoadState('error')
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'center') {
      return
    }

    const abortController = new AbortController()

    const loadNotifications = async () => {
      setActionError('')
      setPageState((currentState) =>
        currentState === 'ready' ? 'ready' : 'loading',
      )

      try {
        const response = await getNotifications(50, null, abortController.signal)
        const loadedIds = new Set(response.notifications.map((item) => item.id))

        setNotifications(response.notifications)
        setSelectedIds((currentSelectedIds) =>
          new Set([...currentSelectedIds].filter((id) => loadedIds.has(id)),
        ))
        setNextCursor(response.next_cursor)
        setHasMore(response.has_more)
        setPageState('ready')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        setPageState('error')
      }
    }

    void loadNotifications()

    return () => abortController.abort()
  }, [activeTab, realtimeVersion])

  const updateBrowserPreference = async (enabled: boolean) => {
    if (!enabled) {
      setPreferences({ browserEnabled: false })
      return
    }

    if (!browserNotificationsSupported || browserNotificationsDenied) {
      setPreferences({ browserEnabled: false })
      return
    }

    const permission =
      window.Notification.permission === 'default'
        ? await window.Notification.requestPermission()
        : window.Notification.permission

    setPreferences({ browserEnabled: permission === 'granted' })
  }

  const setNotificationBusy = (notificationId: string, isBusy: boolean) => {
    setBusyIds((currentBusyIds) => {
      const nextBusyIds = new Set(currentBusyIds)

      if (isBusy) {
        nextBusyIds.add(notificationId)
      } else {
        nextBusyIds.delete(notificationId)
      }

      return nextBusyIds
    })
  }

  const toggleSelection = (notificationId: string) => {
    setSelectedIds((currentSelectedIds) => {
      const nextSelectedIds = new Set(currentSelectedIds)

      if (nextSelectedIds.has(notificationId)) {
        nextSelectedIds.delete(notificationId)
      } else {
        nextSelectedIds.add(notificationId)
      }

      return nextSelectedIds
    })
  }

  const toggleAll = () => {
    if (allLoadedSelected) {
      setSelectedIds(new Set())
      return
    }

    setSelectedIds(new Set(notifications.map((notification) => notification.id)))
  }

  const deleteSelected = async () => {
    const ids = [...selectedIds]

    if (ids.length === 0 || isDeleting) {
      return
    }

    setIsDeleting(true)
    setActionError('')

    try {
      const selectedUnreadCount = notifications.filter(
        (notification) =>
          selectedIds.has(notification.id) && !notification.is_read,
      ).length

      await Promise.all(ids.map((notificationId) => deleteNotification(notificationId)))
      setNotifications((currentNotifications) =>
        currentNotifications.filter((notification) => !selectedIds.has(notification.id)),
      )
      setSelectedIds(new Set())
      onUnreadCountChange(Math.max(0, unreadCount - selectedUnreadCount))
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Не удалось удалить уведомления.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  const openNotification = async (notification: ApiNotification) => {
    if (busyIds.has(notification.id) || isDeleting) {
      return
    }

    setActionError('')

    if (!notification.is_read) {
      setNotificationBusy(notification.id, true)

      try {
        const response = await markNotificationRead(notification.id)

        setNotifications((currentNotifications) =>
          currentNotifications.map((currentNotification) =>
            currentNotification.id === notification.id
              ? response.notification
              : currentNotification,
          ),
        )
        onUnreadCountChange(Math.max(0, unreadCount - 1))
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : 'Не удалось открыть уведомление.',
        )
        setNotificationBusy(notification.id, false)
        return
      }

      setNotificationBusy(notification.id, false)
    }

    if (notification.link) {
      onNavigate(notification.link)
    }
  }

  const loadMore = async () => {
    if (!hasMore || !nextCursor || isLoadingMore) {
      return
    }

    setIsLoadingMore(true)

    try {
      const response = await getNotifications(50, nextCursor)

      setNotifications((currentNotifications) => {
        const existingIds = new Set(
          currentNotifications.map((notification) => notification.id),
        )
        const uniqueNotifications = response.notifications.filter(
          (notification) => !existingIds.has(notification.id),
        )

        return [...currentNotifications, ...uniqueNotifications]
      })
      setNextCursor(response.next_cursor)
      setHasMore(response.has_more)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить уведомления.',
      )
    } finally {
      setIsLoadingMore(false)
    }
  }

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight

    if (distanceToBottom < 80) {
      void loadMore()
    }
  }

  return (
    <section className="figma-notifications-page" aria-label="Уведомления">
      <div className="figma-notifications-tabs" role="tablist" aria-label="Разделы уведомлений">
        <button
          className={activeTab === 'center' ? 'figma-notifications-tabs__active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'center'}
          onClick={() => setActiveTab('center')}
        >
          Центр уведомлений
        </button>
        <button
          className={activeTab === 'settings' ? 'figma-notifications-tabs__active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
        >
          Настройки
        </button>
      </div>

      {activeTab === 'center' ? (
        <section className="figma-notifications-panel" role="tabpanel">
          <div className="figma-notifications-toolbar">
            <label>
              <input
                type="checkbox"
                checked={allLoadedSelected}
                disabled={notifications.length === 0 || isDeleting}
                onChange={toggleAll}
              />
              <span>Выбрать все</span>
            </label>

            <button
              type="button"
              disabled={selectedIds.size === 0 || isDeleting}
              onClick={() => void deleteSelected()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm1 6h2v8H9V9Zm4 0h2v8h-2V9Zm-7 0h2v10h8V9h2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9Z" />
              </svg>
              <span>Удалить</span>
            </button>
          </div>

          {actionError && (
            <div className="figma-notifications-error" role="alert">
              {actionError}
            </div>
          )}

          <div className="figma-notifications-list" onScroll={handleListScroll}>
            {pageState === 'loading' && (
              <div className="figma-notifications-state">Загрузка...</div>
            )}

            {pageState === 'error' && (
              <div className="figma-notifications-state">Не удалось загрузить уведомления</div>
            )}

            {pageState === 'ready' && notifications.length === 0 && (
              <div className="figma-notifications-state">Уведомлений нет</div>
            )}

            {pageState === 'ready' &&
              notifications.map((notification) => {
                const isChat = isChatNotification(notification)
                const tone = getNotificationTone(notification)
                const isBusy = busyIds.has(notification.id)

                if (isChat) {
                  return (
                    <article
                      className={`figma-notification-card figma-notification-card--chat figma-notification-card--${tone}`}
                      key={notification.id}
                    >
                      <label className="figma-notification-card__select">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(notification.id)}
                          disabled={isDeleting || isBusy}
                          aria-label={`Выбрать уведомление «${notification.title}»`}
                          onChange={() => toggleSelection(notification.id)}
                        />
                      </label>

                      <button
                        className="figma-notification-card__chat-content"
                        type="button"
                        disabled={isDeleting || isBusy}
                        onClick={() => void openNotification(notification)}
                      >
                        <strong>{notification.title}</strong>
                        <span className="figma-notification-card__date">
                          {formatNotificationDate(notification.created_at)}
                        </span>
                        <span className="figma-notification-card__message">
                          {notification.content}
                        </span>
                        <span className="figma-notification-card__channel">
                          {getChannelText(notification)}
                        </span>
                        {notification.link && (
                          <span className="figma-notification-card__link">Открыть чат</span>
                        )}
                      </button>
                    </article>
                  )
                }

                return (
                  <article
                    className={`figma-notification-card figma-notification-card--compact figma-notification-card--${tone}`}
                    key={notification.id}
                  >
                    <label className="figma-notification-card__select">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(notification.id)}
                        disabled={isDeleting || isBusy}
                        aria-label={`Выбрать уведомление «${notification.title}»`}
                        onChange={() => toggleSelection(notification.id)}
                      />
                    </label>

                    <button
                      className="figma-notification-card__compact-content"
                      type="button"
                      disabled={isDeleting || isBusy}
                      onClick={() => void openNotification(notification)}
                    >
                      <span className="figma-notification-card__topline">
                        <strong>{notification.title}</strong>
                        <span>{getNotificationCategory(notification)}</span>
                        <span>{formatNotificationDate(notification.created_at)}</span>
                      </span>
                      <span
                        className={`figma-notification-card__status figma-notification-card__status--${tone}`}
                      >
                        {getStatusText(notification, tone)}
                      </span>
                      <span className="figma-notification-card__related">
                        {getRelatedObjectText(notification)}
                      </span>
                    </button>

                    <span className="figma-notification-card__more" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </article>
                )
              })}

            {isLoadingMore && (
              <div className="figma-notifications-state">Загрузка...</div>
            )}
          </div>
        </section>
      ) : (
        <div className="figma-notification-settings" role="tabpanel">
          <section className="figma-notification-settings__card figma-notification-settings__card--sos">
            <h2>Настройка SOS-сигналов</h2>
            <label
              className="figma-notification-settings__search"
              title="Backend не предоставляет API для сохранения и применения SOS-слов."
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 20-4.3-4.3a8 8 0 1 0-1.4 1.4L19.6 21 21 20ZM5 11a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z" />
              </svg>
              <input
                type="text"
                value=""
                disabled
                placeholder="Введите слова, при появлении которых ИИ мгновенно перехватит чат вам"
                aria-label="SOS-слова недоступны: backend API отсутствует"
              />
            </label>
            <p>Примеры тегов: суд, прокуратура, директор, верните деньги, жалоба, скидка 50%</p>
          </section>

          <section className="figma-notification-settings__card figma-notification-settings__card--channels">
            <h2>Настройка каналов доставки (Куда придет пуш)</h2>
            <div className="figma-notification-settings__rows">
              <label title="Backend не предоставляет канал звонка-дозвона для уведомлений.">
                <Toggle
                  checked={false}
                  label="Звонок-дозвон недоступен"
                  disabled
                />
                <span>Звонок-дозвон (для критических ситуаций)</span>
              </label>
              <label title={browserTitle}>
                <Toggle
                  checked={preferences.browserEnabled}
                  label="Браузерное уведомление"
                  disabled={!browserNotificationsSupported || browserNotificationsDenied}
                  title={browserTitle}
                  onChange={(checked) => void updateBrowserPreference(checked)}
                />
                <span>Браузерное уведомление (если открыта десктоп-версия)</span>
              </label>
              <label title={telegramTitle}>
                <Toggle
                  checked={telegramConnected}
                  label={telegramConnected ? 'Telegram подключён' : 'Telegram не подключён'}
                  disabled
                  title={telegramTitle}
                />
                <span>Дублирование в личный Telegram (через системного бота-оповещателя)</span>
              </label>
              <label title="Backend не предоставляет API мобильных push-уведомлений.">
                <Toggle
                  checked={false}
                  label="Push-уведомление недоступно"
                  disabled
                />
                <span>Push-уведомление в мобильном приложении CRM</span>
              </label>
            </div>
          </section>

          <section className="figma-notification-settings__card figma-notification-settings__card--quiet">
            <h2>Режим “ Тихий час “:</h2>
            <label title="Backend не предоставляет настройки расписания тихого часа.">
              <Toggle
                checked={false}
                label="Тихий час недоступен"
                disabled
              />
              <span>Вкл\ выкл</span>
            </label>
          </section>
        </div>
      )}
    </section>
  )
}
