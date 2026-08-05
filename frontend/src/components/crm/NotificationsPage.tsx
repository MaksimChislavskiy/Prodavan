import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  deleteAllNotifications,
  deleteNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type ApiNotification,
} from '../../shared/api/notificationsApi'

type NotificationsPageProps = {
  unreadCount: number
  realtimeVersion: number
  onUnreadCountChange: (count: number) => void
  onNavigate: (href: string) => void
}

type PageState = 'loading' | 'ready' | 'error'
type TabId = 'center' | 'settings'
type ConfirmAction =
  | { kind: 'single'; notificationId: string }
  | { kind: 'selected' }
  | { kind: 'all' }
  | null

type NotificationPreferences = {
  sosKeywords: string
  soundEnabled: boolean
  browserEnabled: boolean
  telegramEnabled: boolean
  mobileEnabled: boolean
  quietHoursEnabled: boolean
  quietFrom: string
  quietTo: string
  quietRecipient: string
}

const SETTINGS_STORAGE_KEY = 'prodavan.notification-settings.v1'

const DEFAULT_PREFERENCES: NotificationPreferences = {
  sosKeywords: 'суд, прокуратура, директор, верните деньги, жалоба, скидка 50%',
  soundEnabled: true,
  browserEnabled: true,
  telegramEnabled: true,
  mobileEnabled: false,
  quietHoursEnabled: false,
  quietFrom: '22:00',
  quietTo: '08:00',
  quietRecipient: '',
}

const ERROR_TYPES = new Set([
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

    const parsed = JSON.parse(storedValue) as Partial<NotificationPreferences>

    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
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

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const notificationDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  )
  const dayDifference = Math.round(
    (today.getTime() - notificationDay.getTime()) / 86_400_000,
  )
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)

  if (dayDifference === 0) {
    return `Сегодня, ${time}`
  }

  if (dayDifference === 1) {
    return `Вчера, ${time}`
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getNotificationIcon(type: string) {
  if (type.includes('task')) {
    return '✓'
  }

  if (type.includes('chat')) {
    return '✉'
  }

  if (type.includes('contact')) {
    return '●'
  }

  if (type.includes('deal')) {
    return '₽'
  }

  if (type.includes('ai')) {
    return 'AI'
  }

  return 'i'
}

function getNotificationCategory(type: string) {
  if (type.includes('task')) {
    return 'Задача'
  }

  if (type.includes('chat')) {
    return 'Чат'
  }

  if (type.includes('contact')) {
    return 'Контакт'
  }

  if (type.includes('deal')) {
    return 'Сделка'
  }

  if (type.includes('ai')) {
    return 'AI'
  }

  return 'Система'
}

function Toggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      className={`notification-toggle ${checked ? 'notification-toggle--active' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="notification-toggle__thumb" />
    </button>
  )
}

export function NotificationsPage({
  unreadCount,
  realtimeVersion,
  onUnreadCountChange,
  onNavigate,
}: NotificationsPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>('center')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [notifications, setNotifications] = useState<ApiNotification[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [pageState, setPageState] = useState<PageState>('loading')
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [isBulkBusy, setIsBulkBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [preferences, setPreferences] = useState(readPreferences)
  const [settingsMessage, setSettingsMessage] = useState('')

  const allLoadedSelected =
    notifications.length > 0 && notifications.every((item) => selectedIds.has(item.id))

  const selectedUnreadCount = useMemo(
    () =>
      notifications.filter(
        (notification) =>
          selectedIds.has(notification.id) && !notification.is_read,
      ).length,
    [notifications, selectedIds],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(preferences),
      )
      setSettingsMessage('Настройки сохранены в этом браузере')

      const timerId = window.setTimeout(() => setSettingsMessage(''), 1800)
      return () => window.clearTimeout(timerId)
    } catch {
      setSettingsMessage('Не удалось сохранить настройки в браузере')
    }
  }, [preferences])

  useEffect(() => {
    if (activeTab !== 'center') {
      return
    }

    const abortController = new AbortController()

    const loadNotifications = async () => {
      setPageState((currentState) =>
        currentState === 'ready' ? 'ready' : 'loading',
      )
      setActionError('')

      try {
        const response = await getNotifications(50, null, abortController.signal)
        setNotifications(response.notifications)
        setNextCursor(response.next_cursor)
        setHasMore(response.has_more)
        setSelectedIds(new Set())
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
  }, [activeTab, realtimeVersion, reloadVersion])

  const updatePreference = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) => {
    setPreferences((currentPreferences) => ({
      ...currentPreferences,
      [key]: value,
    }))
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

  const loadMore = async () => {
    if (!hasMore || !nextCursor || isLoadingMore) {
      return
    }

    setIsLoadingMore(true)
    setActionError('')

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
          : 'Не удалось загрузить уведомления. Попробуйте ещё раз.',
      )
    } finally {
      setIsLoadingMore(false)
    }
  }

  const openNotification = async (notification: ApiNotification) => {
    if (busyIds.has(notification.id)) {
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
            : 'Не удалось отметить уведомление прочитанным.',
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

  const markAllRead = async () => {
    if (isBulkBusy || unreadCount === 0) {
      return
    }

    setIsBulkBusy(true)
    setActionError('')

    try {
      await markAllNotificationsRead()
      const readAt = new Date().toISOString()
      setNotifications((currentNotifications) =>
        currentNotifications.map((notification) => ({
          ...notification,
          is_read: true,
          read_at: notification.read_at ?? readAt,
        })),
      )
      onUnreadCountChange(0)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Не удалось отметить уведомления прочитанными.',
      )
    } finally {
      setIsBulkBusy(false)
    }
  }

  const deleteOne = async (notificationId: string) => {
    const notification = notifications.find((item) => item.id === notificationId)

    setNotificationBusy(notificationId, true)
    setActionError('')

    try {
      await deleteNotification(notificationId)
      setNotifications((currentNotifications) =>
        currentNotifications.filter((item) => item.id !== notificationId),
      )
      setSelectedIds((currentSelectedIds) => {
        const nextSelectedIds = new Set(currentSelectedIds)
        nextSelectedIds.delete(notificationId)
        return nextSelectedIds
      })

      if (notification && !notification.is_read) {
        onUnreadCountChange(Math.max(0, unreadCount - 1))
      }
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Не удалось удалить уведомление.',
      )
    } finally {
      setNotificationBusy(notificationId, false)
      setConfirmAction(null)
    }
  }

  const deleteSelected = async () => {
    const ids = [...selectedIds]

    if (ids.length === 0) {
      setConfirmAction(null)
      return
    }

    setIsBulkBusy(true)
    setActionError('')

    try {
      await Promise.all(ids.map((notificationId) => deleteNotification(notificationId)))
      setNotifications((currentNotifications) =>
        currentNotifications.filter((notification) => !selectedIds.has(notification.id)),
      )
      onUnreadCountChange(Math.max(0, unreadCount - selectedUnreadCount))
      setSelectedIds(new Set())
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Не удалось удалить выбранные уведомления.',
      )
    } finally {
      setIsBulkBusy(false)
      setConfirmAction(null)
    }
  }

  const deleteAll = async () => {
    setIsBulkBusy(true)
    setActionError('')

    try {
      await deleteAllNotifications()
      setNotifications([])
      setSelectedIds(new Set())
      setNextCursor(null)
      setHasMore(false)
      onUnreadCountChange(0)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Не удалось удалить уведомления.',
      )
    } finally {
      setIsBulkBusy(false)
      setConfirmAction(null)
    }
  }

  const runConfirmedAction = () => {
    if (!confirmAction) {
      return
    }

    if (confirmAction.kind === 'single') {
      void deleteOne(confirmAction.notificationId)
      return
    }

    if (confirmAction.kind === 'selected') {
      void deleteSelected()
      return
    }

    void deleteAll()
  }

  const toggleNotificationSelection = (notificationId: string) => {
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

  const toggleAllLoaded = () => {
    if (allLoadedSelected) {
      setSelectedIds(new Set())
      return
    }

    setSelectedIds(new Set(notifications.map((notification) => notification.id)))
  }

  return (
    <section className="notifications-page" aria-labelledby="notifications-title">
      <div className="notifications-page__header">
        <div>
          <p className="notifications-page__eyebrow">Системные события</p>
          <h1 id="notifications-title">Уведомления</h1>
        </div>

        <div className="notifications-page__counter" aria-live="polite">
          <span>{unreadCount > 99 ? '99+' : unreadCount}</span>
          <small>непрочитанных</small>
        </div>
      </div>

      <div className="notifications-tabs" role="tablist" aria-label="Разделы уведомлений">
        <button
          className={activeTab === 'center' ? 'notifications-tabs__button--active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'center'}
          onClick={() => setActiveTab('center')}
        >
          Центр уведомлений
        </button>
        <button
          className={activeTab === 'settings' ? 'notifications-tabs__button--active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
        >
          Настройки
        </button>
      </div>

      {activeTab === 'center' ? (
        <div className="notifications-center" role="tabpanel">
          <div className="notifications-summary-card">
            <div>
              <h2>Все важные события в одном месте</h2>
              <p>
                Здесь появляются события по задачам, сделкам, чатам и действиям AI.
              </p>
            </div>
            <button
              type="button"
              disabled={isBulkBusy || unreadCount === 0}
              onClick={() => void markAllRead()}
            >
              Отметить все прочитанными
            </button>
          </div>

          {pageState === 'loading' && (
            <div className="notifications-skeleton" aria-label="Загрузка уведомлений">
              {Array.from({ length: 5 }, (_, index) => (
                <div className="notifications-skeleton__row" key={index} />
              ))}
            </div>
          )}

          {pageState === 'error' && (
            <div className="notifications-state notifications-state--error">
              <h2>Не удалось загрузить уведомления</h2>
              <p>Проверьте соединение и попробуйте обновить раздел.</p>
              <button
                type="button"
                onClick={() => setReloadVersion((version) => version + 1)}
              >
                Повторить
              </button>
            </div>
          )}

          {pageState === 'ready' && (
            <>
              <div className="notifications-toolbar">
                <label className="notifications-toolbar__select-all">
                  <input
                    type="checkbox"
                    checked={allLoadedSelected}
                    disabled={notifications.length === 0 || isBulkBusy}
                    onChange={toggleAllLoaded}
                  />
                  <span>Выбрать все</span>
                </label>

                <div className="notifications-toolbar__actions">
                  <button
                    type="button"
                    disabled={selectedIds.size === 0 || isBulkBusy}
                    onClick={() => setConfirmAction({ kind: 'selected' })}
                  >
                    Удалить выбранные{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                  </button>
                  <button
                    className="notifications-toolbar__delete-all"
                    type="button"
                    disabled={notifications.length === 0 || isBulkBusy}
                    onClick={() => setConfirmAction({ kind: 'all' })}
                  >
                    Удалить все
                  </button>
                </div>
              </div>

              {actionError && (
                <div className="notifications-action-error" role="alert">
                  {actionError}
                </div>
              )}

              {notifications.length === 0 ? (
                <div className="notifications-state">
                  <div className="notifications-state__icon" aria-hidden="true">✓</div>
                  <h2>Новых уведомлений нет</h2>
                  <p>Все важные события появятся здесь.</p>
                </div>
              ) : (
                <div className="notifications-list">
                  {notifications.map((notification) => {
                    const isBusy = busyIds.has(notification.id)
                    const isDanger = ERROR_TYPES.has(notification.type)

                    return (
                      <article
                        className={[
                          'notification-card',
                          notification.is_read ? 'notification-card--read' : '',
                          isDanger ? 'notification-card--danger' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={notification.id}
                      >
                        <label className="notification-card__select">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(notification.id)}
                            disabled={isBusy || isBulkBusy}
                            aria-label={`Выбрать уведомление «${notification.title}»`}
                            onChange={() => toggleNotificationSelection(notification.id)}
                          />
                        </label>

                        <span className="notification-card__icon" aria-hidden="true">
                          {getNotificationIcon(notification.type)}
                        </span>

                        <button
                          className="notification-card__content"
                          type="button"
                          disabled={isBusy || isBulkBusy}
                          onClick={() => void openNotification(notification)}
                        >
                          <span className="notification-card__topline">
                            <strong>{notification.title}</strong>
                            <span>{formatNotificationDate(notification.created_at)}</span>
                          </span>
                          <span className="notification-card__category">
                            {getNotificationCategory(notification.type)}
                            {!notification.is_read && (
                              <span className="notification-card__unread">Непрочитано</span>
                            )}
                          </span>
                          <span className="notification-card__text">
                            {notification.content}
                          </span>
                          {notification.link && (
                            <span className="notification-card__link">Открыть связанный объект →</span>
                          )}
                        </button>

                        <button
                          className="notification-card__delete"
                          type="button"
                          disabled={isBusy || isBulkBusy}
                          aria-label={`Удалить уведомление «${notification.title}»`}
                          onClick={() =>
                            setConfirmAction({
                              kind: 'single',
                              notificationId: notification.id,
                            })
                          }
                        >
                          ×
                        </button>
                      </article>
                    )
                  })}
                </div>
              )}

              {hasMore && (
                <button
                  className="notifications-load-more"
                  type="button"
                  disabled={isLoadingMore}
                  onClick={() => void loadMore()}
                >
                  {isLoadingMore ? 'Загрузка...' : 'Загрузить ещё'}
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="notification-settings" role="tabpanel">
          <div className="notification-settings__notice">
            Интерфейс настроек подготовлен по макету. Пока backend API для этих параметров
            отсутствует, значения сохраняются только в текущем браузере.
          </div>

          <section className="notification-settings-card">
            <h2>Настройка SOS-сигналов</h2>
            <label className="notification-settings-field">
              <span>Слова и фразы, при которых AI должен позвать менеджера</span>
              <input
                type="text"
                value={preferences.sosKeywords}
                placeholder="Введите слова через запятую"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updatePreference('sosKeywords', event.target.value)
                }
              />
            </label>
            <p className="notification-settings-card__hint">
              Примеры: суд, прокуратура, директор, верните деньги, жалоба, скидка 50%
            </p>
          </section>

          <section className="notification-settings-card">
            <h2>Настройка каналов доставки</h2>
            <div className="notification-settings-list">
              <div className="notification-settings-row">
                <Toggle
                  checked={preferences.soundEnabled}
                  label="Звуковые уведомления"
                  onChange={(checked) => updatePreference('soundEnabled', checked)}
                />
                <div>
                  <strong>Звуковое уведомление</strong>
                  <span>Сигнал при появлении важного события</span>
                </div>
              </div>

              <div className="notification-settings-row">
                <Toggle
                  checked={preferences.browserEnabled}
                  label="Браузерные уведомления"
                  onChange={(checked) => updatePreference('browserEnabled', checked)}
                />
                <div>
                  <strong>Браузерные уведомления</strong>
                  <span>Показывать уведомления, когда открыта другая вкладка</span>
                </div>
              </div>

              <div className="notification-settings-row">
                <Toggle
                  checked={preferences.telegramEnabled}
                  label="Дублирование уведомлений в Telegram"
                  onChange={(checked) => updatePreference('telegramEnabled', checked)}
                />
                <div>
                  <strong>Дублирование в Telegram</strong>
                  <span>Отправлять важные события через подключённого бота</span>
                </div>
              </div>

              <div className="notification-settings-row">
                <Toggle
                  checked={preferences.mobileEnabled}
                  label="Мобильные push-уведомления"
                  onChange={(checked) => updatePreference('mobileEnabled', checked)}
                />
                <div>
                  <strong>Push-уведомления в мобильном приложении</strong>
                  <span>Будет использоваться после появления мобильного приложения</span>
                </div>
              </div>
            </div>
          </section>

          <section className="notification-settings-card">
            <div className="notification-settings-row notification-settings-row--quiet">
              <Toggle
                checked={preferences.quietHoursEnabled}
                label="Тихий час"
                onChange={(checked) => updatePreference('quietHoursEnabled', checked)}
              />
              <div>
                <strong>Режим «Тихий час»</strong>
                <span>Не беспокоить в указанное время</span>
              </div>
            </div>

            {preferences.quietHoursEnabled && (
              <div className="notification-quiet-grid">
                <label>
                  <span>Начало</span>
                  <input
                    type="time"
                    value={preferences.quietFrom}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updatePreference('quietFrom', event.target.value)
                    }
                  />
                </label>
                <label>
                  <span>Окончание</span>
                  <input
                    type="time"
                    value={preferences.quietTo}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updatePreference('quietTo', event.target.value)
                    }
                  />
                </label>
                <label className="notification-quiet-grid__recipient">
                  <span>Кому переадресовать срочные уведомления</span>
                  <input
                    type="text"
                    value={preferences.quietRecipient}
                    placeholder="Например, дежурному менеджеру"
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updatePreference('quietRecipient', event.target.value)
                    }
                  />
                </label>
              </div>
            )}
          </section>

          {settingsMessage && (
            <div className="notification-settings__saved" role="status">
              {settingsMessage}
            </div>
          )}
        </div>
      )}

      {confirmAction && (
        <div className="notification-confirm" role="presentation">
          <div
            className="notification-confirm__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-confirm-title"
          >
            <h2 id="notification-confirm-title">Удалить уведомления?</h2>
            <p>
              {confirmAction.kind === 'single'
                ? 'Уведомление будет удалено без возможности восстановления.'
                : confirmAction.kind === 'selected'
                  ? `Будут удалены выбранные уведомления: ${selectedIds.size}.`
                  : 'Будет удалена вся история уведомлений.'}
            </p>
            <div className="notification-confirm__actions">
              <button
                type="button"
                disabled={isBulkBusy}
                onClick={() => setConfirmAction(null)}
              >
                Отмена
              </button>
              <button
                className="notification-confirm__delete"
                type="button"
                disabled={isBulkBusy}
                onClick={runConfirmedAction}
              >
                {isBulkBusy ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
