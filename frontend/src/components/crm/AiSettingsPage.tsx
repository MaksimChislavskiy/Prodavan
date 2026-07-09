import { useEffect, useState } from 'react'
import { getAiSettings, type ApiAiSettings } from '../../shared/api/aiSettingsApi'
import './AiSettingsPage.css'

type AiSettingsState = {
  settings: ApiAiSettings | null
  isLoading: boolean
  error: string
}

export function AiSettingsPage() {
  const [state, setState] = useState<AiSettingsState>({
    settings: null,
    isLoading: true,
    error: '',
  })

  useEffect(() => {
    let isMounted = true

    async function loadAiSettings() {
      try {
        const settings = await getAiSettings()

        if (isMounted) {
          setState({
            settings,
            isLoading: false,
            error: '',
          })
        }
      } catch (error) {
        if (isMounted) {
          setState({
            settings: null,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Не удалось загрузить настройки AI',
          })
        }
      }
    }

    void loadAiSettings()

    return () => {
      isMounted = false
    }
  }, [])

  if (state.isLoading) {
    return (
      <main className="ai-settings-page">
        <section className="ai-settings-header">
          <p className="ai-settings-header__eyebrow">AI</p>
          <h1 className="ai-settings-header__title">Настройки AI</h1>
          <p className="ai-settings-header__text">Загружаем настройки AI из backend...</p>
        </section>

        <section className="ai-settings-card">
          <div className="ai-settings-skeleton" />
          <div className="ai-settings-skeleton ai-settings-skeleton--short" />
          <div className="ai-settings-skeleton ai-settings-skeleton--textarea" />
        </section>
      </main>
    )
  }

  if (state.error || !state.settings) {
    return (
      <main className="ai-settings-page">
        <section className="ai-settings-header">
          <p className="ai-settings-header__eyebrow">AI</p>
          <h1 className="ai-settings-header__title">Настройки AI</h1>
          <p className="ai-settings-header__text">Не удалось получить настройки AI.</p>
        </section>

        <section className="ai-settings-card">
          <h2 className="ai-settings-card__title">Ошибка загрузки</h2>
          <p className="ai-settings-card__text">{state.error}</p>
        </section>
      </main>
    )
  }

  const { settings } = state

  return (
    <main className="ai-settings-page">
      <section className="ai-settings-header">
        <p className="ai-settings-header__eyebrow">AI</p>
        <h1 className="ai-settings-header__title">Настройки AI</h1>
        <p className="ai-settings-header__text">
          Управление поведением AI-помощника: инструкция, автопилот, база знаний и полезные материалы.
        </p>
      </section>

      <section className="ai-settings-grid">
        <article className="ai-settings-card ai-settings-card--wide">
          <div className="ai-settings-card__header">
            <div>
              <h2 className="ai-settings-card__title">Инструкция для AI</h2>
              <p className="ai-settings-card__text">
                Постоянная инструкция задаёт стиль, тональность и правила ответов AI клиентам.
              </p>
            </div>

            <span className="ai-settings-card__badge">version {settings.version}</span>
          </div>

          <textarea
            className="ai-settings-textarea"
            value={settings.instruction}
            placeholder="Введите инструкцию для AI-помощника"
            readOnly
            rows={8}
          />

          <div className="ai-settings-actions">
            <button className="ai-settings-primary-button" type="button" disabled>
              Сохранить
            </button>
            <span className="ai-settings-hint">Редактирование подключим следующим шагом.</span>
          </div>
        </article>

        <article className="ai-settings-card">
          <h2 className="ai-settings-card__title">Автопилот</h2>
          <p className="ai-settings-card__text">AI сам отвечает на входящие сообщения клиентов.</p>

          <div className="ai-settings-toggle-row">
            <span className="ai-settings-toggle-row__label">
              {settings.autopilot_enabled ? 'Включён' : 'Выключен'}
            </span>

            <span
              className={[
                'ai-settings-toggle',
                settings.autopilot_enabled ? 'ai-settings-toggle--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-hidden="true"
            >
              <span className="ai-settings-toggle__circle" />
            </span>
          </div>

          <dl className="ai-settings-list">
            <div>
              <dt>Режим</dt>
              <dd>{getAutopilotModeText(settings.autopilot_mode)}</dd>
            </div>

            <div>
              <dt>Задержка ответа</dt>
              <dd>{settings.autopilot_delay} сек.</dd>
            </div>

            <div>
              <dt>Ответов сегодня</dt>
              <dd>{settings.current_usage.autopilot_replies_today}</dd>
            </div>
          </dl>
        </article>

        <article className="ai-settings-card">
          <h2 className="ai-settings-card__title">База знаний</h2>
          <p className="ai-settings-card__text">
            Здесь будут документы компании, которые AI использует при формировании ответов.
          </p>

          <div className="ai-settings-empty">
            <div className="ai-settings-empty__icon" aria-hidden="true">
              📄
            </div>
            <p>Список документов подключим отдельным шагом.</p>
          </div>
        </article>

        <article className="ai-settings-card ai-settings-card--wide">
          <h2 className="ai-settings-card__title">Полезные материалы</h2>
          <p className="ai-settings-card__text">
            Быстрый доступ к обучающему видео и PDF-инструкции по настройке AI.
          </p>

          <div className="ai-settings-materials">
            <button className="ai-settings-secondary-button" type="button">
              Смотреть обучающее видео
            </button>

            <a
              className="ai-settings-secondary-button ai-settings-secondary-button--link"
              href="/static/ai_setup_guide.pdf"
              target="_blank"
              rel="noreferrer"
            >
              Читать инструкцию
            </a>
          </div>
        </article>
      </section>
    </main>
  )
}

function getAutopilotModeText(mode: ApiAiSettings['autopilot_mode']) {
  if (mode === 'always') {
    return 'Всегда'
  }

  return 'Если менеджер не ответил'
}
