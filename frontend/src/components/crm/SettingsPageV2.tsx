import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { ApiError } from '../../shared/api/apiClient'
import {
  connectTelegram,
  disconnectTelegram,
  getWorkspaceSettings,
  updateWorkspaceSettings,
  type ApiCompanySettings,
  type ApiWorkspaceIntegration,
  type ApiWorkspaceSettings,
  type UpdateWorkspaceSettingsPayload,
} from '../../shared/api/workspaceSettingsApi'
import './SettingsPage.css'
import './SettingsPageContract.css'

type SettingsTab = 'company' | 'integrations'
type Feedback = { type: 'success' | 'error'; text: string } | null
type PendingLeave =
  | { kind: 'tab'; tab: SettingsTab }
  | { kind: 'href'; href: string }
  | null

type CompanyErrors = Partial<Record<keyof ApiCompanySettings, string>>

const SETTINGS_CONFLICT_MESSAGE =
  'Настройки были изменены другим пользователем. Обновите страницу и повторите попытку.'
const UNSAVED_MESSAGE =
  'У вас есть несохранённые изменения. Покинуть страницу без сохранения?'

const EMPTY_COMPANY: ApiCompanySettings = {
  full_name: '',
  short_name: null,
  legal_address: null,
  postal_address: null,
  inn: null,
  kpp: null,
  ogrn: null,
  okved: null,
  okpo: null,
}

const FALLBACK_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Moscow',
  'Asia/Yekaterinburg',
  'Asia/Novosibirsk',
  'Asia/Vladivostok',
  'Asia/Almaty',
  'Asia/Tbilisi',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Bangkok',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
]

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('company')
  const [settings, setSettings] = useState<ApiWorkspaceSettings | null>(null)
  const [company, setCompany] = useState<ApiCompanySettings>(EMPTY_COMPANY)
  const [timezone, setTimezone] = useState('UTC')
  const [timezoneSearch, setTimezoneSearch] = useState('')
  const [initialSnapshot, setInitialSnapshot] = useState('')
  const [telegram, setTelegram] = useState<ApiWorkspaceIntegration | null>(null)
  const [botToken, setBotToken] = useState('')
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false)
  const [isReconnectMode, setIsReconnectMode] = useState(false)
  const [isDisconnectConfirmOpen, setIsDisconnectConfirmOpen] = useState(false)
  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<PendingLeave>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTelegramLoading, setIsTelegramLoading] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [telegramFeedback, setTelegramFeedback] = useState<Feedback>(null)

  const loadControllerRef = useRef<AbortController | null>(null)
  const saveControllerRef = useRef<AbortController | null>(null)
  const telegramControllerRef = useRef<AbortController | null>(null)
  const idempotencyRef = useRef({ key: createUuid(), payload: '' })

  const normalizedDraft = useMemo(
    () => normalizeDraft(timezone, company),
    [company, timezone],
  )
  const currentSnapshot = useMemo(
    () => JSON.stringify(normalizedDraft),
    [normalizedDraft],
  )
  const isDirty = Boolean(settings && initialSnapshot && currentSnapshot !== initialSnapshot)
  const companyErrors = useMemo(() => validateCompany(company), [company])
  const hasValidationErrors = Object.keys(companyErrors).length > 0
  const canSave = Boolean(settings && isDirty && !hasValidationErrors && !isSaving)

  const timezoneOptions = useMemo(() => getTimezoneOptions(), [])
  const groupedTimezones = useMemo(
    () => groupTimezones(filterTimezones(timezoneOptions, timezoneSearch, timezone)),
    [timezone, timezoneOptions, timezoneSearch],
  )

  const loadSettings = async () => {
    loadControllerRef.current?.abort()
    const controller = new AbortController()
    loadControllerRef.current = controller
    setIsLoading(true)
    setFeedback(null)

    try {
      const workspaceSettings = await getWorkspaceSettings(controller.signal)
      if (controller.signal.aborted) {
        return
      }

      const loadedCompany = normalizeCompanyForForm(workspaceSettings.company)
      setSettings(workspaceSettings)
      setCompany(loadedCompany)
      setTimezone(workspaceSettings.timezone || 'UTC')
      setTelegram(
        workspaceSettings.integrations.find((item) => item.type === 'telegram') ?? null,
      )
      setInitialSnapshot(
        JSON.stringify(normalizeDraft(workspaceSettings.timezone || 'UTC', loadedCompany)),
      )
      setTimezoneSearch('')
    } catch (error) {
      if (!isAbortError(error)) {
        setSettings(null)
        setFeedback({
          type: 'error',
          text: error instanceof Error ? error.message : 'Не удалось загрузить настройки.',
        })
      }
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null
      }
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadSettings()
    return () => {
      loadControllerRef.current?.abort()
      saveControllerRef.current?.abort()
      telegramControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!isDirty) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) {
        return
      }

      const link = event.target.closest<HTMLAnchorElement>('a[href]')
      if (
        !link
        || link.target === '_blank'
        || link.origin !== window.location.origin
        || link.href === window.location.href
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setPendingLeave({ kind: 'href', href: link.href })
      setIsLeaveConfirmOpen(true)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleDocumentClick, true)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [isDirty])

  const updateCompanyField = (field: keyof ApiCompanySettings, value: string) => {
    setCompany((current) => ({
      ...current,
      [field]: field === 'full_name' ? value : value === '' ? null : value,
    }))
    setFeedback(null)
  }

  const requestTabChange = (tab: SettingsTab) => {
    if (tab === activeTab) {
      return
    }
    if (activeTab === 'company' && isDirty) {
      setPendingLeave({ kind: 'tab', tab })
      setIsLeaveConfirmOpen(true)
      return
    }
    setActiveTab(tab)
  }

  const discardCompanyChanges = () => {
    if (!settings) {
      return
    }
    const restored = normalizeCompanyForForm(settings.company)
    setCompany(restored)
    setTimezone(settings.timezone || 'UTC')
    setInitialSnapshot(
      JSON.stringify(normalizeDraft(settings.timezone || 'UTC', restored)),
    )
    setFeedback(null)
  }

  const confirmLeave = () => {
    const target = pendingLeave
    setPendingLeave(null)
    setIsLeaveConfirmOpen(false)
    discardCompanyChanges()

    if (!target) {
      return
    }
    if (target.kind === 'tab') {
      setActiveTab(target.tab)
      return
    }
    window.location.assign(target.href)
  }

  const handleCompanySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settings || !canSave) {
      return
    }

    const patch = buildSettingsPatch(settings, normalizedDraft)
    const request: UpdateWorkspaceSettingsPayload = {
      version: settings.version,
      ...patch,
    }
    const serializedPayload = JSON.stringify(request)
    if (idempotencyRef.current.payload !== serializedPayload) {
      idempotencyRef.current = {
        key: createUuid(),
        payload: serializedPayload,
      }
    }

    saveControllerRef.current?.abort()
    const controller = new AbortController()
    saveControllerRef.current = controller
    setIsSaving(true)
    setFeedback(null)

    try {
      const updated = await updateWorkspaceSettings(
        request,
        idempotencyRef.current.key,
        controller.signal,
      )
      if (controller.signal.aborted) {
        return
      }

      const updatedCompany = normalizeCompanyForForm(updated.company)
      setSettings(updated)
      setCompany(updatedCompany)
      setTimezone(updated.timezone || 'UTC')
      setInitialSnapshot(
        JSON.stringify(normalizeDraft(updated.timezone || 'UTC', updatedCompany)),
      )
      setFeedback({ type: 'success', text: 'Настройки сохранены' })
      idempotencyRef.current = { key: createUuid(), payload: '' }
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      setFeedback({
        type: 'error',
        text:
          error instanceof ApiError && error.status === 409
            ? SETTINGS_CONFLICT_MESSAGE
            : error instanceof Error
              ? error.message
              : 'Не удалось сохранить настройки.',
      })
    } finally {
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null
      }
      setIsSaving(false)
    }
  }

  const openConnectModal = (reconnect: boolean) => {
    setIsReconnectMode(reconnect)
    setBotToken('')
    setTelegramFeedback(null)
    setIsConnectModalOpen(true)
  }

  const handleTelegramConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedToken = botToken.trim()
    if (!normalizedToken || isTelegramLoading) {
      return
    }

    telegramControllerRef.current?.abort()
    const controller = new AbortController()
    telegramControllerRef.current = controller
    setIsTelegramLoading(true)
    setTelegramFeedback(null)

    try {
      const response = await connectTelegram(normalizedToken, controller.signal)
      if (controller.signal.aborted) {
        return
      }
      setTelegram(response.integration)
      setBotToken('')
      setIsConnectModalOpen(false)
      setTelegramFeedback({ type: 'success', text: response.message })
    } catch (error) {
      if (!isAbortError(error)) {
        setTelegramFeedback({
          type: 'error',
          text: error instanceof Error ? error.message : 'Не удалось подключить Telegram-бота.',
        })
      }
    } finally {
      if (telegramControllerRef.current === controller) {
        telegramControllerRef.current = null
      }
      setIsTelegramLoading(false)
    }
  }

  const handleTelegramDisconnect = async () => {
    if (isTelegramLoading) {
      return
    }

    telegramControllerRef.current?.abort()
    const controller = new AbortController()
    telegramControllerRef.current = controller
    setIsTelegramLoading(true)
    setTelegramFeedback(null)

    try {
      const response = await disconnectTelegram(controller.signal)
      if (controller.signal.aborted) {
        return
      }
      setTelegram(response.integration)
      setIsDisconnectConfirmOpen(false)
      setTelegramFeedback({ type: 'success', text: response.message })
    } catch (error) {
      if (!isAbortError(error)) {
        setIsDisconnectConfirmOpen(false)
        setTelegramFeedback({
          type: 'error',
          text: error instanceof Error ? error.message : 'Не удалось отключить Telegram-бота.',
        })
      }
    } finally {
      if (telegramControllerRef.current === controller) {
        telegramControllerRef.current = null
      }
      setIsTelegramLoading(false)
    }
  }

  const closeConnectModal = () => {
    if (isTelegramLoading) {
      return
    }
    setIsConnectModalOpen(false)
    setBotToken('')
  }

  if (isLoading) {
    return (
      <section className="settings-page settings-page--state" aria-busy="true">
        Загружаем настройки...
      </section>
    )
  }

  if (!settings) {
    return (
      <section className="settings-page settings-page--state settings-page--error">
        <p>{feedback?.text ?? 'Настройки недоступны.'}</p>
        <button type="button" onClick={() => void loadSettings()}>
          Повторить
        </button>
      </section>
    )
  }

  const isTelegramConnected = telegram?.status === 'connected'

  return (
    <section className="settings-page">
      <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
        <button
          className={activeTab === 'company'
            ? 'settings-tabs__button settings-tabs__button--active'
            : 'settings-tabs__button'}
          type="button"
          role="tab"
          aria-selected={activeTab === 'company'}
          onClick={() => requestTabChange('company')}
        >
          Моя компания
        </button>
        <button
          className={activeTab === 'integrations'
            ? 'settings-tabs__button settings-tabs__button--active'
            : 'settings-tabs__button'}
          type="button"
          role="tab"
          aria-selected={activeTab === 'integrations'}
          onClick={() => requestTabChange('integrations')}
        >
          Интеграции
        </button>
      </div>

      {activeTab === 'company' ? (
        <form className="settings-company" noValidate onSubmit={handleCompanySubmit}>
          <div className="settings-company__top-row">
            <SettingsField label="Часовой пояс">
              <input
                className="settings-timezone-search"
                type="search"
                placeholder="Поиск часового пояса"
                value={timezoneSearch}
                onChange={(event) => setTimezoneSearch(event.target.value)}
              />
              <select
                value={timezone}
                onChange={(event) => {
                  setTimezone(event.target.value)
                  setFeedback(null)
                }}
              >
                {[...groupedTimezones.entries()].map(([region, zones]) => (
                  <optgroup label={region} key={region}>
                    {zones.map((zone) => (
                      <option value={zone} key={zone}>
                        {formatTimezoneLabel(zone)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </SettingsField>

            <SettingsField label="Язык интерфейса">
              <input value="Русский (по умолчанию)" disabled readOnly />
            </SettingsField>
          </div>

          <div className="settings-company__details">
            <SettingsField label="Полное наименование" error={companyErrors.full_name}>
              <input
                maxLength={255}
                required
                placeholder="Введите значение"
                value={company.full_name}
                onChange={(event) => updateCompanyField('full_name', event.target.value)}
              />
            </SettingsField>
            <SettingsField label="ИНН" error={companyErrors.inn}>
              <input
                inputMode="numeric"
                maxLength={12}
                placeholder="Введите значение"
                value={company.inn ?? ''}
                onChange={(event) => updateCompanyField('inn', event.target.value)}
              />
            </SettingsField>
            <SettingsField label="Сокращённое наименование" error={companyErrors.short_name}>
              <input
                maxLength={255}
                placeholder="Введите значение"
                value={company.short_name ?? ''}
                onChange={(event) => updateCompanyField('short_name', event.target.value)}
              />
            </SettingsField>
            <SettingsField label="КПП" error={companyErrors.kpp}>
              <input
                inputMode="numeric"
                maxLength={9}
                placeholder="Введите значение"
                value={company.kpp ?? ''}
                onChange={(event) => updateCompanyField('kpp', event.target.value)}
              />
            </SettingsField>
            <SettingsField label="Юридический адрес" error={companyErrors.legal_address}>
              <input
                maxLength={1000}
                placeholder="Введите значение"
                value={company.legal_address ?? ''}
                onChange={(event) => updateCompanyField('legal_address', event.target.value)}
              />
            </SettingsField>
            <SettingsField label="ОГРН" error={companyErrors.ogrn}>
              <input
                inputMode="numeric"
                maxLength={15}
                placeholder="Введите значение"
                value={company.ogrn ?? ''}
                onChange={(event) => updateCompanyField('ogrn', event.target.value)}
              />
            </SettingsField>
            <SettingsField label="Почтовый адрес" error={companyErrors.postal_address}>
              <input
                maxLength={1000}
                placeholder="Введите значение"
                value={company.postal_address ?? ''}
                onChange={(event) => updateCompanyField('postal_address', event.target.value)}
              />
            </SettingsField>
            <SettingsField label="ОКВЭД" error={companyErrors.okved}>
              <input
                maxLength={20}
                placeholder="Введите значение"
                value={company.okved ?? ''}
                onChange={(event) => updateCompanyField('okved', event.target.value)}
              />
            </SettingsField>
            <span aria-hidden="true" />
            <SettingsField label="ОКПО" error={companyErrors.okpo}>
              <input
                inputMode="numeric"
                maxLength={10}
                placeholder="Введите значение"
                value={company.okpo ?? ''}
                onChange={(event) => updateCompanyField('okpo', event.target.value)}
              />
            </SettingsField>
          </div>

          <footer className="settings-company__footer">
            {feedback && (
              <p
                className={`settings-feedback settings-feedback--${feedback.type}`}
                role={feedback.type === 'error' ? 'alert' : 'status'}
              >
                {feedback.text}
              </p>
            )}
            <button
              className="settings-primary-button"
              type="submit"
              disabled={!canSave}
            >
              {isSaving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </footer>
        </form>
      ) : (
        <div className="settings-integrations">
          <article className="telegram-card telegram-card--contract">
            <div className="telegram-card__title">
              <TelegramIcon />
              <span>Telegram</span>
            </div>

            <div className="telegram-card__status">
              <strong>{getIntegrationStatusLabel(telegram)}</strong>
              {isTelegramConnected && telegram?.bot_username && (
                <span>{normalizeBotUsername(telegram.bot_username)}</span>
              )}
              {isTelegramConnected && (
                <small>{getIntegrationHealthText(telegram)}</small>
              )}
              {isTelegramConnected && telegram?.last_check_at && (
                <small>
                  Последняя проверка: {formatDateTime(telegram.last_check_at, settings.timezone)}
                </small>
              )}
            </div>

            {isTelegramConnected ? (
              <div className="telegram-card__actions">
                <button
                  className="telegram-card__action"
                  type="button"
                  disabled={isTelegramLoading}
                  onClick={() => openConnectModal(true)}
                >
                  Переподключить
                </button>
                <button
                  className="telegram-card__action telegram-card__action--disconnect"
                  type="button"
                  disabled={isTelegramLoading}
                  onClick={() => setIsDisconnectConfirmOpen(true)}
                >
                  Отключить
                </button>
              </div>
            ) : (
              <button
                className="telegram-card__action"
                type="button"
                disabled={isTelegramLoading}
                onClick={() => openConnectModal(false)}
              >
                Подключить
              </button>
            )}
          </article>

          {telegramFeedback && (
            <p
              className={`settings-feedback settings-feedback--${telegramFeedback.type}`}
              role={telegramFeedback.type === 'error' ? 'alert' : 'status'}
            >
              {telegramFeedback.text}
            </p>
          )}
        </div>
      )}

      {isConnectModalOpen && (
        <div
          className="telegram-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeConnectModal()
            }
          }}
        >
          <form
            className="telegram-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="telegram-connect-title"
            onSubmit={handleTelegramConnect}
          >
            <h2 id="telegram-connect-title">
              {isReconnectMode
                ? 'Переподключение Telegram-бота'
                : 'Подключение Telegram-бота'}
            </h2>
            <p>
              Введите токен Telegram-бота,<br />полученный в BotFather
            </p>
            <input
              type="password"
              autoComplete="off"
              required
              minLength={20}
              maxLength={512}
              placeholder="Введите токен бота от BotFather"
              aria-label="Токен Telegram-бота"
              value={botToken}
              onChange={(event) => {
                setBotToken(event.target.value)
                setTelegramFeedback(null)
              }}
              autoFocus
            />
            {telegramFeedback?.type === 'error' && (
              <p className="telegram-modal__error" role="alert">
                {telegramFeedback.text}
              </p>
            )}
            <div className="telegram-modal__actions">
              <button type="button" onClick={closeConnectModal}>
                Отмена
              </button>
              <button
                type="submit"
                disabled={isTelegramLoading || !botToken.trim()}
              >
                {isTelegramLoading ? 'Проверяем...' : isReconnectMode ? 'Переподключить' : 'Подключить'}
              </button>
            </div>
          </form>
        </div>
      )}

      {isDisconnectConfirmOpen && (
        <DecisionModal
          title="Отключить Telegram-интеграцию?"
          text="Вы уверены, что хотите отключить Telegram-интеграцию? Чат-история останется доступной, но новые сообщения не будут приниматься."
          primaryLabel={isTelegramLoading ? 'Отключение...' : 'Отключить'}
          secondaryLabel="Отмена"
          danger
          disabled={isTelegramLoading}
          onPrimary={() => void handleTelegramDisconnect()}
          onSecondary={() => setIsDisconnectConfirmOpen(false)}
        />
      )}

      {isLeaveConfirmOpen && (
        <DecisionModal
          title="Несохранённые изменения"
          text={UNSAVED_MESSAGE}
          primaryLabel="Покинуть"
          secondaryLabel="Остаться"
          danger
          onPrimary={confirmLeave}
          onSecondary={() => {
            setPendingLeave(null)
            setIsLeaveConfirmOpen(false)
          }}
        />
      )}
    </section>
  )
}

function SettingsField({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className={`settings-field${error ? ' settings-field--error' : ''}`}>
      <span>{label}</span>
      {children}
      {error && <em role="alert">{error}</em>}
    </label>
  )
}

function DecisionModal({
  title,
  text,
  primaryLabel,
  secondaryLabel,
  danger = false,
  disabled = false,
  onPrimary,
  onSecondary,
}: {
  title: string
  text: string
  primaryLabel: string
  secondaryLabel: string
  danger?: boolean
  disabled?: boolean
  onPrimary: () => void
  onSecondary: () => void
}) {
  return (
    <div className="settings-decision-overlay" role="presentation">
      <div
        className="settings-decision-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2>{title}</h2>
        <p>{text}</p>
        <div>
          <button type="button" disabled={disabled} onClick={onSecondary}>
            {secondaryLabel}
          </button>
          <button
            className={danger ? 'is-danger' : ''}
            type="button"
            disabled={disabled}
            onClick={onPrimary}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function TelegramIcon() {
  return (
    <span className="telegram-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path
          d="M21.4 3.3 18.3 20c-.2 1.2-.9 1.5-1.9.9l-4.7-3.5-2.3 2.2c-.2.3-.5.5-1 .5l.3-4.8 8.8-8c.4-.3-.1-.5-.6-.2L6 14l-4.7-1.5c-1-.3-1-1 .2-1.5L20 3.9c.9-.3 1.7.2 1.4-.6Z"
          fill="currentColor"
        />
      </svg>
    </span>
  )
}

function normalizeCompanyForForm(company: ApiCompanySettings): ApiCompanySettings {
  return {
    full_name: company.full_name ?? '',
    short_name: company.short_name ?? null,
    legal_address: company.legal_address ?? null,
    postal_address: company.postal_address ?? null,
    inn: company.inn ?? null,
    kpp: company.kpp ?? null,
    ogrn: company.ogrn ?? null,
    okved: company.okved ?? null,
    okpo: company.okpo ?? null,
  }
}

function normalizeDraft(timezone: string, company: ApiCompanySettings) {
  return {
    timezone,
    company: {
      full_name: company.full_name.trim(),
      short_name: nullableTrim(company.short_name),
      legal_address: nullableTrim(company.legal_address),
      postal_address: nullableTrim(company.postal_address),
      inn: nullableTrim(company.inn),
      kpp: nullableTrim(company.kpp),
      ogrn: nullableTrim(company.ogrn),
      okved: nullableTrim(company.okved),
      okpo: nullableTrim(company.okpo),
    },
  }
}

function nullableTrim(value: string | null) {
  if (value === null) {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

function buildSettingsPatch(
  settings: ApiWorkspaceSettings,
  draft: ReturnType<typeof normalizeDraft>,
): Omit<UpdateWorkspaceSettingsPayload, 'version'> {
  const patch: Omit<UpdateWorkspaceSettingsPayload, 'version'> = {}
  if (draft.timezone !== settings.timezone) {
    patch.timezone = draft.timezone
  }

  const companyPatch: Partial<ApiCompanySettings> = {}
  const current = normalizeDraft(settings.timezone, settings.company).company
  ;(Object.keys(draft.company) as (keyof ApiCompanySettings)[]).forEach((field) => {
    if (draft.company[field] !== current[field]) {
      companyPatch[field] = draft.company[field] as never
    }
  })

  if (Object.keys(companyPatch).length > 0) {
    patch.company = companyPatch
  }
  return patch
}

function validateCompany(company: ApiCompanySettings): CompanyErrors {
  const errors: CompanyErrors = {}
  const fullName = company.full_name.trim()
  if (!fullName) {
    errors.full_name = 'Полное наименование обязательно.'
  } else if (fullName.length > 255) {
    errors.full_name = 'Максимум 255 символов.'
  }

  const shortName = nullableTrim(company.short_name)
  if (shortName && shortName.length > 255) {
    errors.short_name = 'Максимум 255 символов.'
  }

  const legalAddress = nullableTrim(company.legal_address)
  if (legalAddress && legalAddress.length > 1000) {
    errors.legal_address = 'Максимум 1000 символов.'
  }

  const postalAddress = nullableTrim(company.postal_address)
  if (postalAddress && postalAddress.length > 1000) {
    errors.postal_address = 'Максимум 1000 символов.'
  }

  const inn = nullableTrim(company.inn)
  if (inn && !isValidInn(inn)) {
    errors.inn = 'Некорректный ИНН'
  }

  const kpp = nullableTrim(company.kpp)
  if (kpp && !/^\d{9}$/.test(kpp)) {
    errors.kpp = 'Некорректный КПП'
  }

  const ogrn = nullableTrim(company.ogrn)
  if (ogrn && !isValidOgrn(ogrn)) {
    errors.ogrn = 'Некорректный ОГРН'
  }

  const okved = nullableTrim(company.okved)
  if (okved && (!/^\d+(?:\.\d+)*$/.test(okved) || okved.length > 20)) {
    errors.okved = 'Некорректный ОКВЭД'
  }

  const okpo = nullableTrim(company.okpo)
  if (okpo && !/^(?:\d{8}|\d{10})$/.test(okpo)) {
    errors.okpo = 'ОКПО должен содержать 8 или 10 цифр.'
  }

  return errors
}

function isValidInn(value: string) {
  if (!/^\d+$/.test(value) || ![10, 12].includes(value.length)) {
    return false
  }
  const digits = [...value].map(Number)
  if (digits.length === 10) {
    const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8]
    const check = weights.reduce((sum, weight, index) => sum + weight * digits[index], 0) % 11 % 10
    return check === digits[9]
  }
  const weights11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const weights12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const check11 = weights11.reduce((sum, weight, index) => sum + weight * digits[index], 0) % 11 % 10
  const check12 = weights12.reduce((sum, weight, index) => sum + weight * digits[index], 0) % 11 % 10
  return check11 === digits[10] && check12 === digits[11]
}

function isValidOgrn(value: string) {
  if (!/^\d+$/.test(value) || ![13, 15].includes(value.length)) {
    return false
  }
  const divisor = value.length === 13 ? 11 : 13
  return Number(BigInt(value.slice(0, -1)) % BigInt(divisor) % 10n) === Number(value.at(-1))
}

function getTimezoneOptions() {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[]
  }
  const supported = intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? []
  return Array.from(new Set(['UTC', ...supported, ...FALLBACK_TIMEZONES])).sort()
}

function filterTimezones(options: string[], query: string, selected: string) {
  const normalized = query.trim().toLocaleLowerCase('ru-RU')
  const filtered = normalized
    ? options.filter((zone) => formatTimezoneLabel(zone).toLocaleLowerCase('ru-RU').includes(normalized))
    : options
  if (!filtered.includes(selected)) {
    return [selected, ...filtered]
  }
  return filtered
}

function groupTimezones(options: string[]) {
  const groups = new Map<string, string[]>()
  options.forEach((zone) => {
    const region = zone === 'UTC' ? 'UTC' : zone.split('/')[0] || 'Другие'
    const values = groups.get(region) ?? []
    values.push(zone)
    groups.set(region, values)
  })
  return groups
}

function formatTimezoneLabel(zone: string) {
  if (zone === 'UTC') {
    return 'UTC (UTC+0)'
  }
  try {
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    }).formatToParts(new Date())
    const offset = parts.find((part) => part.type === 'timeZoneName')?.value
      .replace('GMT', 'UTC')
      .replace('UTC+0', 'UTC+0')
    return offset ? `${zone} (${offset})` : zone
  } catch {
    return zone
  }
}

function getIntegrationStatusLabel(integration: ApiWorkspaceIntegration | null) {
  if (!integration || integration.status !== 'connected') {
    return 'Не подключено'
  }
  if (integration.health_status === 'healthy') {
    return 'Подключено · работает'
  }
  if (integration.health_status === 'degraded') {
    return 'Подключено · ограничено'
  }
  if (integration.health_status === 'error') {
    return 'Подключено · ошибка'
  }
  return 'Подключено'
}

function getIntegrationHealthText(integration: ApiWorkspaceIntegration | null) {
  if (!integration || integration.status !== 'connected') {
    return ''
  }
  if (integration.health_status === 'healthy') {
    return 'Бот доступен, webhook настроен.'
  }
  if (integration.health_status === 'degraded') {
    return 'Бот доступен, но доставка сообщений ограничена.'
  }
  if (integration.health_status === 'error') {
    return integration.last_error || 'Telegram-бот недоступен.'
  }
  return 'Ожидается проверка состояния интеграции.'
}

function normalizeBotUsername(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

function formatDateTime(value: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || 'UTC',
    }).format(new Date(value))
  } catch {
    return new Date(value).toLocaleString('ru-RU')
  }
}

function createUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-')
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
