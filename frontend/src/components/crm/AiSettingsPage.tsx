import { useEffect, useRef, useState } from 'react'
import {
  deleteKnowledgeFile,
  getAiSettings,
  getKnowledgeFiles,
  updateAiSettings,
  uploadKnowledgeFiles,
  type ApiAiSettings,
  type ApiKnowledgeDocument,
  type ApiKnowledgeFilesResponse,
} from '../../shared/api/aiSettingsApi'
import './AiSettingsPage.css'
import './AiSettingsPageRefresh.css'

const MAX_INSTRUCTION_LENGTH = 5000
const KNOWLEDGE_PAGE_SIZE = 50

type AiSettingsState = {
  settings: ApiAiSettings | null
  isLoading: boolean
  error: string
}

type KnowledgeFilesState = {
  files: ApiKnowledgeDocument[]
  total: number
  storage: ApiKnowledgeFilesResponse['storage'] | null
  isLoading: boolean
  error: string
}

type SaveStatus = 'idle' | 'success' | 'error'

export function AiSettingsPage() {
  const knowledgeFileInputRef = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<AiSettingsState>({ settings: null, isLoading: true, error: '' })
  const [knowledgeState, setKnowledgeState] = useState<KnowledgeFilesState>({
    files: [],
    total: 0,
    storage: null,
    isLoading: true,
    error: '',
  })
  const [instruction, setInstruction] = useState('')
  const [initialInstruction, setInitialInstruction] = useState('')
  const [isInstructionSaving, setIsInstructionSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [isAutopilotSaving, setIsAutopilotSaving] = useState(false)
  const [autopilotStatus, setAutopilotStatus] = useState<SaveStatus>('idle')
  const [autopilotMessage, setAutopilotMessage] = useState('')
  const [isAutopilotConfirmOpen, setIsAutopilotConfirmOpen] = useState(false)
  const [isKnowledgeUploading, setIsKnowledgeUploading] = useState(false)
  const [isKnowledgeRefreshing, setIsKnowledgeRefreshing] = useState(false)
  const [knowledgeUploadStatus, setKnowledgeUploadStatus] = useState<SaveStatus>('idle')
  const [knowledgeUploadMessage, setKnowledgeUploadMessage] = useState('')
  const [deletingKnowledgeFileId, setDeletingKnowledgeFileId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadAiSettings() {
      try {
        const settings = await getAiSettings()
        if (!isMounted) return

        setState({ settings, isLoading: false, error: '' })
        setInstruction(settings.instruction)
        setInitialInstruction(settings.instruction)
      } catch (error) {
        if (!isMounted) return
        setState({
          settings: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Не удалось загрузить настройки AI',
        })
      }
    }

    async function loadKnowledgeFiles() {
      try {
        const response = await getKnowledgeFiles(1, KNOWLEDGE_PAGE_SIZE)
        if (!isMounted) return

        setKnowledgeState({
          files: response.files,
          total: response.total,
          storage: response.storage,
          isLoading: false,
          error: '',
        })
      } catch (error) {
        if (!isMounted) return
        setKnowledgeState({
          files: [],
          total: 0,
          storage: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Не удалось загрузить базу знаний',
        })
      }
    }

    void loadAiSettings()
    void loadKnowledgeFiles()

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
  const isInstructionChanged = instruction !== initialInstruction
  const isInstructionTooLong = instruction.length > MAX_INSTRUCTION_LENGTH
  const canSaveInstruction = isInstructionChanged && !isInstructionTooLong && !isInstructionSaving

  const refreshKnowledgeFiles = async () => {
    const response = await getKnowledgeFiles(1, KNOWLEDGE_PAGE_SIZE)
    setKnowledgeState({
      files: response.files,
      total: response.total,
      storage: response.storage,
      isLoading: false,
      error: '',
    })
  }

  const handleInstructionSave = async () => {
    if (!canSaveInstruction) return

    setIsInstructionSaving(true)
    setSaveStatus('idle')
    setSaveMessage('')

    try {
      const updatedSettings = await updateAiSettings({ version: settings.version, instruction })
      setState({ settings: updatedSettings, isLoading: false, error: '' })
      setInstruction(updatedSettings.instruction)
      setInitialInstruction(updatedSettings.instruction)
      setSaveStatus('success')
      setSaveMessage('Инструкция сохранена')
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error instanceof Error ? error.message : 'Не удалось сохранить инструкцию')
    } finally {
      setIsInstructionSaving(false)
    }
  }

  const updateAutopilot = async (isEnabled: boolean) => {
    if (isAutopilotSaving) return

    setIsAutopilotSaving(true)
    setAutopilotStatus('idle')
    setAutopilotMessage('')

    try {
      const updatedSettings = await updateAiSettings({
        version: settings.version,
        autopilot_enabled: isEnabled,
      })
      setState({ settings: updatedSettings, isLoading: false, error: '' })
      setAutopilotStatus('success')
      setAutopilotMessage(isEnabled ? 'Автопилот включён' : 'Автопилот выключен')
    } catch (error) {
      setAutopilotStatus('error')
      setAutopilotMessage(error instanceof Error ? error.message : 'Не удалось изменить автопилот')
    } finally {
      setIsAutopilotSaving(false)
    }
  }

  const handleAutopilotClick = () => {
    if (isAutopilotSaving) return

    setAutopilotStatus('idle')
    setAutopilotMessage('')

    if (settings.autopilot_enabled) {
      void updateAutopilot(false)
      return
    }

    setIsAutopilotConfirmOpen(true)
  }

  const handleKnowledgeRefresh = async () => {
    if (isKnowledgeRefreshing) return

    setIsKnowledgeRefreshing(true)
    setKnowledgeUploadStatus('idle')
    setKnowledgeUploadMessage('')

    try {
      await refreshKnowledgeFiles()
    } catch (error) {
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(error instanceof Error ? error.message : 'Не удалось обновить список файлов')
    } finally {
      setIsKnowledgeRefreshing(false)
    }
  }

  const handleKnowledgeFilesUpload = async (files: File[]) => {
    if (files.length === 0 || isKnowledgeUploading) return

    setIsKnowledgeUploading(true)
    setKnowledgeUploadStatus('idle')
    setKnowledgeUploadMessage('')

    try {
      const uploadResponse = await uploadKnowledgeFiles(files)
      await refreshKnowledgeFiles()
      setKnowledgeUploadStatus('success')
      setKnowledgeUploadMessage(`Загружено файлов: ${uploadResponse.accepted}`)
    } catch (error) {
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(error instanceof Error ? error.message : 'Не удалось загрузить файлы')
    } finally {
      setIsKnowledgeUploading(false)
      if (knowledgeFileInputRef.current) knowledgeFileInputRef.current.value = ''
    }
  }

  const handleKnowledgeFileDelete = async (file: ApiKnowledgeDocument) => {
    if (deletingKnowledgeFileId) return
    if (!window.confirm(`Удалить файл «${file.name}» из базы знаний?`)) return

    setDeletingKnowledgeFileId(file.id)
    setKnowledgeUploadStatus('idle')
    setKnowledgeUploadMessage('')

    try {
      await deleteKnowledgeFile(file.id)
      await refreshKnowledgeFiles()
      setKnowledgeUploadStatus('success')
      setKnowledgeUploadMessage('Файл удалён')
    } catch (error) {
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(error instanceof Error ? error.message : 'Не удалось удалить файл')
    } finally {
      setDeletingKnowledgeFileId(null)
    }
  }

  return (
    <main className="ai-settings-page">
      <section className="ai-settings-card ai-settings-card--instruction">
        <h1 className="ai-settings-card__title">Инструкция для AI</h1>

        <textarea
          className="ai-settings-instruction-input"
          value={instruction}
          placeholder="Введите инструкцию для AI-помощника"
          maxLength={MAX_INSTRUCTION_LENGTH + 1}
          rows={1}
          onChange={(event) => {
            setInstruction(event.target.value)
            setSaveStatus('idle')
            setSaveMessage('')
          }}
        />

        <div className="ai-settings-instruction-footer">
          <span className={isInstructionTooLong ? 'ai-settings-instruction-counter ai-settings-instruction-counter--error' : 'ai-settings-instruction-counter'}>
            {instruction.length}/{MAX_INSTRUCTION_LENGTH}
          </span>
          {saveMessage && (
            <span className={saveStatus === 'error' ? 'ai-settings-save-message ai-settings-save-message--error' : 'ai-settings-save-message'}>
              {saveMessage}
            </span>
          )}
        </div>

        <button
          className="ai-settings-save-button"
          type="button"
          disabled={!canSaveInstruction}
          onClick={() => void handleInstructionSave()}
        >
          {isInstructionSaving ? 'Сохраняем...' : 'Сохранить'}
        </button>
      </section>

      <section className="ai-settings-card ai-settings-card--autopilot">
        <div className="ai-settings-autopilot-title-row">
          <button
            className={settings.autopilot_enabled ? 'ai-settings-switch ai-settings-switch--active' : 'ai-settings-switch'}
            type="button"
            aria-label={settings.autopilot_enabled ? 'Выключить автопилот' : 'Включить автопилот'}
            aria-pressed={settings.autopilot_enabled}
            disabled={isAutopilotSaving}
            onClick={handleAutopilotClick}
          >
            <span className="ai-settings-switch__button" />
          </button>
          <h2 className="ai-settings-card__title">Автопилот</h2>
        </div>

        <p className="ai-settings-card__text">AI сам отвечает на все входящие сообщения клиентов</p>
        {autopilotMessage && (
          <p className={autopilotStatus === 'error' ? 'ai-settings-autopilot-message ai-settings-autopilot-message--error' : 'ai-settings-autopilot-message'}>
            {autopilotMessage}
          </p>
        )}
      </section>

      <section className="ai-settings-card ai-settings-card--knowledge">
        <div className="ai-settings-knowledge-header">
          <div>
            <h2 className="ai-settings-card__title">База знаний</h2>
            <p className="ai-settings-card__text">Необходимо, чтобы Анна Ai “поумнела”</p>
          </div>

          <div className="ai-settings-knowledge-actions">
            {knowledgeState.storage && (
              <span className="ai-settings-storage-summary">
                {knowledgeState.storage.files_count}/{knowledgeState.storage.files_limit} файлов · {formatFileSize(knowledgeState.storage.used_bytes)} из {formatFileSize(knowledgeState.storage.limit_bytes)}
              </span>
            )}
            <button
              className="ai-settings-refresh-button"
              type="button"
              disabled={knowledgeState.isLoading || isKnowledgeRefreshing}
              onClick={() => void handleKnowledgeRefresh()}
            >
              {isKnowledgeRefreshing ? 'Обновляем...' : 'Обновить'}
            </button>
          </div>
        </div>

        <div className="ai-settings-upload-box">
          <span className="ai-settings-upload-box__icon" aria-hidden="true">↥</span>
          <span>Чтобы загрузить документ, перетащите их сюда или нажмите</span>
          <input
            className="ai-settings-file-input"
            ref={knowledgeFileInputRef}
            type="file"
            accept=".pdf,.txt,.docx,.csv,application/pdf,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            onChange={(event) => void handleKnowledgeFilesUpload(Array.from(event.target.files ?? []))}
          />
          <button
            className="ai-settings-upload-box__button"
            type="button"
            disabled={isKnowledgeUploading}
            onClick={() => knowledgeFileInputRef.current?.click()}
          >
            {isKnowledgeUploading ? 'Загружаем...' : 'Загрузить⌄'}
          </button>
        </div>

        {knowledgeUploadMessage && (
          <p className={knowledgeUploadStatus === 'error' ? 'ai-settings-upload-message ai-settings-upload-message--error' : 'ai-settings-upload-message'}>
            {knowledgeUploadMessage}
          </p>
        )}

        <div className="ai-settings-knowledge-list">
          {knowledgeState.isLoading ? (
            <p className="ai-settings-knowledge-empty">Загружаем список документов...</p>
          ) : knowledgeState.error ? (
            <p className="ai-settings-knowledge-error">{knowledgeState.error}</p>
          ) : knowledgeState.files.length === 0 ? (
            <p className="ai-settings-knowledge-empty">Файлы пока не загружены</p>
          ) : (
            <div className="ai-settings-knowledge-table-wrapper">
              <table className="ai-settings-knowledge-table">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Размер</th>
                    <th>Дата загрузки</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {knowledgeState.files.map((file) => (
                    <tr key={file.id}>
                      <td>{file.name}</td>
                      <td>{formatFileSize(file.size)}</td>
                      <td>{formatDate(file.uploaded_at)}</td>
                      <td>
                        <span className={`ai-settings-status-badge ai-settings-status-badge--${file.status}`}>
                          {getKnowledgeStatusLabel(file.status)}
                        </span>
                      </td>
                      <td>
                        <button
                          className="ai-settings-table-action-button"
                          type="button"
                          disabled={deletingKnowledgeFileId === file.id}
                          onClick={() => void handleKnowledgeFileDelete(file)}
                        >
                          {deletingKnowledgeFileId === file.id ? 'Удаляем...' : 'Удалить'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!knowledgeState.isLoading && !knowledgeState.error && knowledgeState.total > 0 && (
            <p className="ai-settings-knowledge-total">Показано {knowledgeState.files.length} из {knowledgeState.total}</p>
          )}
        </div>
      </section>

      <section className="ai-settings-card ai-settings-card--materials">
        <h2 className="ai-settings-card__title">Полезные материалы</h2>
        <div className="ai-settings-materials">
          <button className="ai-settings-video-button" type="button">
            <span aria-hidden="true">▶</span>
            Смотреть обучающее видео
          </button>
          <a className="ai-settings-guide-link" href="/static/ai_setup_guide.pdf" target="_blank" rel="noreferrer">
            Читать инструкцию
          </a>
        </div>
      </section>

      <button className="ai-settings-reset-button" type="button">Сброс настроек</button>

      {isAutopilotConfirmOpen && (
        <div className="ai-settings-modal-backdrop" role="presentation">
          <div className="ai-settings-modal" role="dialog" aria-modal="true" aria-labelledby="ai-autopilot-confirm-title">
            <h2 className="ai-settings-modal__title" id="ai-autopilot-confirm-title">Включить автопилот?</h2>
            <p className="ai-settings-modal__text">AI сможет автоматически отвечать клиентам в чате. Продолжить?</p>
            <div className="ai-settings-modal__actions">
              <button className="ai-settings-modal__button ai-settings-modal__button--secondary" type="button" onClick={() => setIsAutopilotConfirmOpen(false)}>
                Отмена
              </button>
              <button
                className="ai-settings-modal__button ai-settings-modal__button--primary"
                type="button"
                disabled={isAutopilotSaving}
                onClick={() => {
                  setIsAutopilotConfirmOpen(false)
                  void updateAutopilot(true)
                }}
              >
                Включить
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} МБ`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} ГБ`
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

function getKnowledgeStatusLabel(status: ApiKnowledgeDocument['status']) {
  if (status === 'uploading') return 'Загружается'
  if (status === 'processing') return 'Обработка'
  if (status === 'ready') return 'Готово'
  return 'Ошибка'
}
