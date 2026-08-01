import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../../shared/api/apiClient'
import {
  connectTelegram,
  disconnectTelegram,
  getTelegramSettings,
  getWorkspaceSettings,
  updateWorkspaceSettings,
  type ApiCompanySettings,
  type ApiWorkspaceIntegration,
  type ApiWorkspaceSettings,
} from '../../shared/api/workspaceSettingsApi'
import './SettingsPage.css'

type SettingsTab = 'company' | 'integrations'
type Feedback = { type: 'success' | 'error'; text: string } | null

const TIMEZONES = [
  { value: 'UTC', label: '(GMT +00:00) UTC' },
  { value: 'Europe/Moscow', label: '(GMT +03:00) Москва' },
  { value: 'Europe/Amsterdam', label: '(GMT +02:00) Амстердам' },
  { value: 'Asia/Yekaterinburg', label: '(GMT +05:00) Екатеринбург' },
  { value: 'Asia/Novosibirsk', label: '(GMT +07:00) Новосибирск' },
  { value: 'Asia/Vladivostok', label: '(GMT +10:00) Владивосток' },
]

const EMPTY_COMPANY: ApiCompanySettings = {
  full_name: '', short_name: null, legal_address: null, postal_address: null,
  inn: null, kpp: null, ogrn: null, okved: null, okpo: null,
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('company')
  const [settings, setSettings] = useState<ApiWorkspaceSettings | null>(null)
  const [company, setCompany] = useState<ApiCompanySettings>(EMPTY_COMPANY)
  const [timezone, setTimezone] = useState('UTC')
  const [telegram, setTelegram] = useState<ApiWorkspaceIntegration | null>(null)
  const [botToken, setBotToken] = useState('')
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTelegramLoading, setIsTelegramLoading] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [telegramFeedback, setTelegramFeedback] = useState<Feedback>(null)

  useEffect(() => {
    let isMounted = true
    Promise.all([getWorkspaceSettings(), getTelegramSettings()])
      .then(([workspaceSettings, telegramSettings]) => {
        if (!isMounted) return
        setSettings(workspaceSettings)
        setCompany(workspaceSettings.company)
        setTimezone(workspaceSettings.timezone)
        setTelegram(telegramSettings.integration)
      })
      .catch((error) => {
        if (!isMounted) return
        setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось загрузить настройки.' })
      })
      .finally(() => { if (isMounted) setIsLoading(false) })
    return () => { isMounted = false }
  }, [])

  const updateCompanyField = (field: keyof ApiCompanySettings, value: string) => {
    setCompany((current) => ({ ...current, [field]: field === 'full_name' ? value : value || null }))
    setFeedback(null)
  }

  const handleCompanySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settings || isSaving) return
    setIsSaving(true)
    setFeedback(null)
    try {
      const updated = await updateWorkspaceSettings({ version: settings.version, timezone, company })
      setSettings(updated)
      setCompany(updated.company)
      setTimezone(updated.timezone)
      setFeedback({ type: 'success', text: 'Настройки сохранены' })
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof ApiError && error.status === 409
          ? 'Настройки уже изменены. Обновите страницу и повторите попытку.'
          : error instanceof Error ? error.message : 'Не удалось сохранить настройки.',
      })
    } finally { setIsSaving(false) }
  }

  const handleTelegramConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedToken = botToken.trim()
    if (!normalizedToken || isTelegramLoading) return
    setIsTelegramLoading(true)
    setTelegramFeedback(null)
    try {
      const response = await connectTelegram(normalizedToken)
      setTelegram(response.integration)
      setBotToken('')
      setIsConnectModalOpen(false)
      setTelegramFeedback({ type: 'success', text: response.message })
    } catch (error) {
      setTelegramFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось подключить Telegram-бота.' })
    } finally { setIsTelegramLoading(false) }
  }

  const handleTelegramDisconnect = async () => {
    if (isTelegramLoading || !window.confirm('Отключить Telegram-бота?')) return
    setIsTelegramLoading(true)
    setTelegramFeedback(null)
    try {
      const response = await disconnectTelegram()
      setTelegram(response.integration)
      setTelegramFeedback({ type: 'success', text: response.message })
    } catch (error) {
      setTelegramFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось отключить Telegram-бота.' })
    } finally { setIsTelegramLoading(false) }
  }

  const closeConnectModal = () => {
    if (isTelegramLoading) return
    setIsConnectModalOpen(false)
    setBotToken('')
    setTelegramFeedback(null)
  }

  if (isLoading) return <section className="settings-page settings-page--state">Загружаем настройки...</section>
  if (!settings) return <section className="settings-page settings-page--state settings-page--error">{feedback?.text ?? 'Настройки недоступны.'}</section>

  const isTelegramConnected = telegram?.status === 'connected'

  return (
    <section className="settings-page">
      <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
        <button className={activeTab === 'company' ? 'settings-tabs__button settings-tabs__button--active' : 'settings-tabs__button'} type="button" role="tab" aria-selected={activeTab === 'company'} onClick={() => setActiveTab('company')}>Моя компания</button>
        <button className={activeTab === 'integrations' ? 'settings-tabs__button settings-tabs__button--active' : 'settings-tabs__button'} type="button" role="tab" aria-selected={activeTab === 'integrations'} onClick={() => setActiveTab('integrations')}>Интеграции</button>
      </div>

      {activeTab === 'company' ? (
        <form className="settings-company" onSubmit={handleCompanySubmit}>
          <div className="settings-company__top-row">
            <SettingsField label="Часовой пояс">
              <select value={timezone} onChange={(event) => { setTimezone(event.target.value); setFeedback(null) }}>
                {TIMEZONES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select>
            </SettingsField>
            <SettingsField label="Язык">
              <select value={settings.language} disabled><option value={settings.language}>Русский (по умолчанию)</option></select>
            </SettingsField>
          </div>

          <div className="settings-company__details">
            <SettingsField label="Полное наименование"><input maxLength={255} placeholder="Введите значение" value={company.full_name} onChange={(event) => updateCompanyField('full_name', event.target.value)} /></SettingsField>
            <SettingsField label="ИНН"><input inputMode="numeric" maxLength={12} placeholder="Введите значение" value={company.inn ?? ''} onChange={(event) => updateCompanyField('inn', event.target.value)} /></SettingsField>
            <SettingsField label="Сокращенное наименование"><input maxLength={255} placeholder="Введите значение" value={company.short_name ?? ''} onChange={(event) => updateCompanyField('short_name', event.target.value)} /></SettingsField>
            <SettingsField label="КПП"><input inputMode="numeric" maxLength={9} placeholder="Введите значение" value={company.kpp ?? ''} onChange={(event) => updateCompanyField('kpp', event.target.value)} /></SettingsField>
            <SettingsField label="Юридический адрес"><input maxLength={1000} placeholder="Введите значение" value={company.legal_address ?? ''} onChange={(event) => updateCompanyField('legal_address', event.target.value)} /></SettingsField>
            <SettingsField label="ОГРН"><input inputMode="numeric" maxLength={15} placeholder="Введите значение" value={company.ogrn ?? ''} onChange={(event) => updateCompanyField('ogrn', event.target.value)} /></SettingsField>
            <SettingsField label="Почтовый адрес"><input maxLength={1000} placeholder="Введите значение" value={company.postal_address ?? ''} onChange={(event) => updateCompanyField('postal_address', event.target.value)} /></SettingsField>
            <SettingsField label="ОКВЭД"><input maxLength={20} placeholder="Введите значение" value={company.okved ?? ''} onChange={(event) => updateCompanyField('okved', event.target.value)} /></SettingsField>
            <span aria-hidden="true" />
            <SettingsField label="ОКПО"><input inputMode="numeric" maxLength={10} placeholder="Введите значение" value={company.okpo ?? ''} onChange={(event) => updateCompanyField('okpo', event.target.value)} /></SettingsField>
          </div>

          <footer className="settings-company__footer">
            {feedback && <p className={`settings-feedback settings-feedback--${feedback.type}`} role="status">{feedback.text}</p>}
            <button className="settings-primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Сохраняем...' : 'Сохранить'}</button>
          </footer>
        </form>
      ) : (
        <div className="settings-integrations">
          <article className="telegram-card">
            <div className="telegram-card__title"><TelegramIcon /><span>Telegram</span></div>
            <p>{isTelegramConnected ? `Подключён бот ${telegram.bot_username || ''}` : 'Бот не подключён'}</p>
            <p>{isTelegramConnected ? 'Интеграция активна' : 'Бесплатный'}</p>
            {isTelegramConnected ? (
              <button className="telegram-card__action telegram-card__action--disconnect" type="button" disabled={isTelegramLoading} onClick={() => void handleTelegramDisconnect()}>{isTelegramLoading ? 'Отключаем...' : 'Отключить'}</button>
            ) : (
              <button className="telegram-card__action" type="button" onClick={() => { setTelegramFeedback(null); setIsConnectModalOpen(true) }}>Подключить</button>
            )}
          </article>
          {telegramFeedback && <p className={`settings-feedback settings-feedback--${telegramFeedback.type}`} role="status">{telegramFeedback.text}</p>}
        </div>
      )}

      {isConnectModalOpen && (
        <div className="telegram-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConnectModal() }}>
          <form className="telegram-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="telegram-connect-title" onSubmit={handleTelegramConnect}>
            <h2 id="telegram-connect-title">Подключение Telegram-бота</h2>
            <p>Введите токен Telegram-бота,<br />полученный в BotFather</p>
            <input type="password" autoComplete="off" required minLength={20} maxLength={512} placeholder="Введите токен бота от BotFather" aria-label="Токен Telegram-бота" value={botToken} onChange={(event) => { setBotToken(event.target.value); setTelegramFeedback(null) }} autoFocus />
            {telegramFeedback?.type === 'error' && <p className="telegram-modal__error" role="alert">{telegramFeedback.text}</p>}
            <div className="telegram-modal__actions">
              <button type="button" onClick={closeConnectModal}>Отмена</button>
              <button type="submit" disabled={isTelegramLoading || !botToken.trim()}>{isTelegramLoading ? 'Проверяем...' : 'Подключить'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="settings-field"><span>{label}</span>{children}</label>
}

function TelegramIcon() {
  return <span className="telegram-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21.4 3.3 18.3 20c-.2 1.2-.9 1.5-1.9.9l-4.7-3.5-2.3 2.2c-.2.3-.5.5-1 .5l.3-4.8 8.8-8c.4-.3-.1-.5-.6-.2L6 14l-4.7-1.5c-1-.3-1-1 .2-1.5L20 3.9c.9-.3 1.7.2 1.4-.6Z" fill="currentColor" /></svg></span>
}
