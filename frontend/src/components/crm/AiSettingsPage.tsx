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
        <section className="ai-settings-card ai-settings-card--instruction">
          <h1 className="ai-settings-card__title">Инструкция для AI</h1>
          <div className="ai-settings-skeleton" />
          <div className="ai-settings-skeleton ai-settings-skeleton--button" />
        </section>
      </main>
    )
  }

  if (state.error || !state.settings) {
    return (
      <main className="ai-settings-page">
        <section className="ai-settings-card ai-settings-card--instruction">
          <h1 className="ai-settings-card__title">Ошибка загрузки</h1>
          <p className="ai-settings-card__text">{state.error || 'Не удалось получить настройки AI.'}</p>
        </section>
      </main>
    )
  }

  const { settings } = state

  return (
    <main className="ai-settings-page">
      <section className="ai-settings-card ai-settings-card--instruction">
        <h1 className="ai-settings-card__title">Инструкция для AI</h1>

        <textarea
          className="ai-settings-instruction-input"
          value={settings.instruction}
          placeholder="Введите инструкцию для AI-помощника"
          readOnly
          rows={1}
        />

        <button className="ai-settings-save-button" type="button" disabled>
          Сохранить
        </button>
      </section>

      <section className="ai-settings-card ai-settings-card--autopilot">
        <div className="ai-settings-autopilot-title-row">
          <span
            className={[
              'ai-settings-switch',
              settings.autopilot_enabled ? 'ai-settings-switch--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
          >
            <span className="ai-settings-switch__button" />
          </span>

          <h2 className="ai-settings-card__title">Автопилот</h2>
        </div>

        <p className="ai-settings-card__text">AI сам отвечает на все входящие сообщения клиентов</p>
      </section>

      <section className="ai-settings-card ai-settings-card--knowledge">
        <h2 className="ai-settings-card__title">База знаний</h2>
        <p className="ai-settings-card__text">Необходимо, чтобы Анна Ai “поумнела”</p>

        <div className="ai-settings-upload-box">
          <span className="ai-settings-upload-box__icon" aria-hidden="true">
            ↥
          </span>
          <span>Чтобы загрузить документ, перетащите их сюда или нажмите</span>
          <button className="ai-settings-upload-box__button" type="button">
            Загрузить⌄
          </button>
        </div>
      </section>

      <section className="ai-settings-card ai-settings-card--materials">
        <h2 className="ai-settings-card__title">Полезные материалы</h2>

        <div className="ai-settings-materials">
          <button className="ai-settings-video-button" type="button">
            <span aria-hidden="true">▶</span>
            Смотреть обучающее видео
          </button>

          <a
            className="ai-settings-guide-link"
            href="/static/ai_setup_guide.pdf"
            target="_blank"
            rel="noreferrer"
          >
            Читать инструкцию
          </a>
        </div>
      </section>

      <button className="ai-settings-reset-button" type="button">
        Сброс настроек
      </button>
    </main>
  )
}
