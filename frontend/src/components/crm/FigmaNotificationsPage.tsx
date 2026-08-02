import { useEffect, useState, type ChangeEvent, type UIEvent } from 'react'
import {
  deleteNotification,
  getNotifications,
  markNotificationRead,
  type ApiNotification,
} from '../../shared/api/notificationsApi'

type FigmaNotificationsPageProps = {
  unreadCount: number
  realtimeVersion: number
  onUnreadCountChange: (count: number) => void
  onNavigate: (href: string) => void
}

type TabId = 'center' | 'settings'
type PageState = 'loading' | 'ready' | 'error'

type NotificationPreferences = {
  sosKeywords: string
  callEnabled: boolean
  browserEnabled: boolean
  telegramEnabled: boolean
  mobileEnabled: boolean
  quietHoursEnabled: boolean
}

const SETTINGS_STORAGE_KEY = 'prodavan.notification-settings.figma.v1'

const DEFAULT_PREFERENCES: NotificationPreferences = {
  sosKeywords: '',
  callEnabled: false,
  browserEnabled: false,
  telegramEnabled: false,
  mobileEnabled: false,
  quietHoursEnabled: false,
}

const URGENT_NOTIFICATION_TYPES = new Set([
  'task_overdue',
  'chat_message_delivery_failed',
  'ai_limit_reached',
  'ai_action_failed',
])

function readPreferences(): NotificationPreferences {
  try {
    const storedValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY)

    if (!storedValue) {
      return DEFAULT_PREFERENCES
    }

    return {
      ...DEFAULT_PREFERENCES,
      ...(JSON.parse(storedValue) as Partial<NotificationPreferences>),
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function formatNotificationDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getNotificationCategory(type: string) {
  if (type.includes('task')) {
    return 'Задача'
  }

  if (type.includes('deal')) {
    return 'Сделка'
  }

  if (type.includes('contact')) {
    return 'Контакт'
  }

  if (type.includes('chat')) {
    return 'Чат'
  }

  if (type.includes('ai')) {
    return 'AI'
  }

  return 'Система'
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      className={`figma-notification-toggle ${checked ? 'figma-notification-toggle--active' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
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
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [preferences, setPreferences] = useState(readPreferences)

  const allLoadedSelected =
    notifications.length > 0 && notifications.every((item) => selectedIds.has(item.id))

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(preferences),
      )
    } catch {
      return
    }
  }, [preferences])

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
          new Set([...currentSelectedIds].filter((id) => loadedIds.has(id))),
        )
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

  const updatePreference = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) => {
    setPreferences((currentPreferences) => ({
      ...currentPreferences,
      [key]: value,
    }))
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
    setActionError('')

    if (!notification.is_read) {
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
        return
      }
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
        <div role="tabpanel">
          <section className="figma-notifications-analytics">
            <h2>Аналитика перехватов:</h2>
            <p>
              AI комментарий: «За сегодня было 15 перехватов. Основная причина — вопросы по
              логистике (60%)». Это сигнал, что нужно обновить базу знаний в разделе ИИ
            </p>
          </section>

          <section className="figma-notifications-list-card">
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
                  const isUrgent =
                    !notification.is_read || URGENT_NOTIFICATION_TYPES.has(notification.type)

                  return (
                    <article
                      className={`figma-notification-row ${isUrgent ? 'figma-notification-row--urgent' : ''}`}
                      key={notification.id}
                    >
                      <label className="figma-notification-row__select">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(notification.id)}
                          disabled={isDeleting}
                          aria-label={`Выбрать уведомление «${notification.title}»`}
                          onChange={() => toggleSelection(notification.id)}
                        />
                      </label>

                      <button
                        className="figma-notification-row__content"
                        type="button"
                        disabled={isDeleting}
                        onClick={() => void openNotification(notification)}
                      >
                        <span className="figma-notification-row__topline">
                          <strong>{notification.title}</strong>
                          <span>{formatNotificationDate(notification.created_at)}</span>
                        </span>
                        <span className="figma-notification-row__category">
                          {getNotificationCategory(notification.type)}
                        </span>
                        <span className="figma-notification-row__text">
                          {notification.content}
                        </span>
                      </button>
                    </article>
                  )
                })}

              {isLoadingMore && (
                <div className="figma-notifications-state">Загрузка...</div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="figma-notification-settings" role="tabpanel">
          <section className="figma-notification-settings__card figma-notification-settings__card--sos">
            <h2>Настройка SOS-сигналов</h2>
            <label className="figma-notification-settings__search">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 20-4.3-4.3a8 8 0 1 0-1.4 1.4L19.6 21 21 20ZM5 11a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z" />
              </svg>
              <input
                type="text"
                value={preferences.sosKeywords}
                placeholder="Введите слова, при появлении которых ИИ мгновенно перехватит чат вам"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updatePreference('sosKeywords', event.target.value)
                }
              />
            </label>
            <p>Примеры тегов: суд, прокуратура, директор, верните деньги, жалоба, скидка 50%</p>
          </section>

          <section className="figma-notification-settings__card figma-notification-settings__card--channels">
            <h2>Настройка каналов доставки (Куда придет пуш)</h2>
            <div className="figma-notification-settings__rows">
              <label>
                <Toggle
                  checked={preferences.callEnabled}
                  label="Звонок-дозвон"
                  onChange={(checked) => updatePreference('callEnabled', checked)}
                />
                <span>Звонок-дозвон (для критических ситуаций)</span>
              </label>
              <label>
                <Toggle
                  checked={preferences.browserEnabled}
                  label="Браузерное уведомление"
                  onChange={(checked) => updatePreference('browserEnabled', checked)}
                />
                <span>Браузерное уведомление (если открыта десктоп-версия)</span>
              </label>
              <label>
                <Toggle
                  checked={preferences.telegramEnabled}
                  label="Дублирование в Telegram"
                  onChange={(checked) => updatePreference('telegramEnabled', checked)}
                />
                <span>Дублирование в личный Telegram (через системного бота-оповещателя)</span>
              </label>
              <label>
                <Toggle
                  checked={preferences.mobileEnabled}
                  label="Push-уведомление"
                  onChange={(checked) => updatePreference('mobileEnabled', checked)}
                />
                <span>Push-уведомление в мобильном приложении CRM</span>
              </label>
            </div>
          </section>

          <section className="figma-notification-settings__card figma-notification-settings__card--quiet">
            <h2>Режим “ Тихий час “:</h2>
            <label>
              <Toggle
                checked={preferences.quietHoursEnabled}
                label="Тихий час"
                onChange={(checked) => updatePreference('quietHoursEnabled', checked)}
              />
              <span>Вкл\ выкл</span>
            </label>
          </section>
        </div>
      )}
    </section>
  )
}
