import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import {
  deleteKnowledgeFile,
  getAiSettings,
  getKnowledgeFiles,
  resetAiSettings,
  retryKnowledgeFile,
  updateAiSettings,
  uploadKnowledgeFiles,
  type ApiAiSettings,
  type ApiKnowledgeDocument,
  type ApiKnowledgeFilesResponse,
  type ApiKnowledgeSort,
  type ApiKnowledgeStorage,
} from '../../shared/api/aiSettingsApi'
import './AiSettingsPage.css'
import './AiSettingsPageRefresh.css'
import './AiSettingsPageFixes.css'
import './AiSettingsPageNewTz.css'

const MAX_INSTRUCTION_LENGTH = 5000
const KNOWLEDGE_PAGE_SIZE = 50
const MAX_KNOWLEDGE_FILE_SIZE = 20 * 1024 * 1024
const MAX_KNOWLEDGE_FILES_PER_UPLOAD = 20
const MAX_KNOWLEDGE_FILE_NAME_LENGTH = 255
const ALLOWED_KNOWLEDGE_FILE_EXTENSIONS = ['pdf', 'txt', 'docx', 'csv']
const KNOWLEDGE_FILE_ACCEPT = '.pdf,.txt,.docx,.csv,application/pdf,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const AI_SETUP_GUIDE_URL = '/static/ai_setup_guide.pdf'
const KNOWLEDGE_STORAGE_FULL_MESSAGE = 'Достигнут лимит хранилища. Удалите часть документов для продолжения работы.'

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

type PendingKnowledgeUpload = {
  id: string
  name: string
  size: number
}

type SaveStatus = 'idle' | 'success' | 'error'

type LeaveWarningState = {
  href: string
  message: string
} | null

export function AiSettingsPage() {
  const knowledgeFileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadControllerRef = useRef<AbortController | null>(null)
  const [state, setState] = useState<AiSettingsState>({ settings: null, isLoading: true, error: '' })
  const [knowledgeState, setKnowledgeState] = useState<KnowledgeFilesState>({
    files: [],
    total: 0,
    storage: null,
    isLoading: true,
    error: '',
  })
  const [knowledgePage, setKnowledgePage] = useState(1)
  const [knowledgeSearchDraft, setKnowledgeSearchDraft] = useState('')
  const [knowledgeSearch, setKnowledgeSearch] = useState('')
  const [knowledgeSort, setKnowledgeSort] = useState<ApiKnowledgeSort>('uploaded_at:desc')
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
  const [pendingKnowledgeUploads, setPendingKnowledgeUploads] = useState<PendingKnowledgeUpload[]>([])
  const [isKnowledgeRefreshing, setIsKnowledgeRefreshing] = useState(false)
  const [isKnowledgeDragActive, setIsKnowledgeDragActive] = useState(false)
  const [knowledgeUploadStatus, setKnowledgeUploadStatus] = useState<SaveStatus>('idle')
  const [knowledgeUploadMessage, setKnowledgeUploadMessage] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ApiKnowledgeDocument | null>(null)
  const [deletingKnowledgeFileId, setDeletingKnowledgeFileId] = useState<string | null>(null)
  const [retryingKnowledgeFileId, setRetryingKnowledgeFileId] = useState<string | null>(null)
  const [isResetSaving, setIsResetSaving] = useState(false)
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)
  const [resetStatus, setResetStatus] = useState<SaveStatus>('idle')
  const [resetMessage, setResetMessage] = useState('')
  const [leaveWarning, setLeaveWarning] = useState<LeaveWarningState>(null)

  const hasUnsavedInstruction = instruction !== initialInstruction
  const hasPendingKnowledgeDocuments = knowledgeState.files.some(
    (file) => file.status === 'uploading' || file.status === 'processing',
  )

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
          error: error instanceof Error
            ? error.message
            : 'Не удалось загрузить настройки. Обновите страницу.',
        })
      }
    }

    async function loadKnowledgeFiles() {
      try {
        const response = await getKnowledgeFiles(1, KNOWLEDGE_PAGE_SIZE)
        if (!isMounted) return

        setKnowledgePage(response.page)
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
          error: error instanceof Error
            ? error.message
            : 'Не удалось загрузить список документов. Обновите страницу.',
        })
      }
    }

    void loadAiSettings()
    void loadKnowledgeFiles()

    return () => {
      isMounted = false
      uploadControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!hasPendingKnowledgeDocuments) return

    let isDisposed = false
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const response = await getKnowledgeFiles(
            knowledgePage,
            KNOWLEDGE_PAGE_SIZE,
            knowledgeSearch,
            knowledgeSort,
          )
          if (isDisposed) return
          setKnowledgeState({
            files: response.files,
            total: response.total,
            storage: response.storage,
            isLoading: false,
            error: '',
          })
        } catch {
          // Фоновое обновление не должно перекрывать уже загруженный список ошибкой.
        }
      })()
    }, 2000)

    return () => {
      isDisposed = true
      window.clearInterval(intervalId)
    }
  }, [hasPendingKnowledgeDocuments, knowledgePage, knowledgeSearch, knowledgeSort])

  useEffect(() => {
    const shouldWarn = isKnowledgeUploading || hasUnsavedInstruction
    if (!shouldWarn) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    const handleInternalLinkClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return

      const url = new URL(anchor.href, window.location.href)
      if (
        url.origin !== window.location.origin
        || !url.pathname.startsWith('/app')
        || url.href === window.location.href
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setLeaveWarning({
        href: `${url.pathname}${url.search}${url.hash}`,
        message: isKnowledgeUploading
          ? 'Идёт загрузка документов. Покинуть страницу?'
          : 'У вас есть несохранённые изменения. Покинуть страницу без сохранения?',
      })
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleInternalLinkClick, true)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleInternalLinkClick, true)
    }
  }, [hasUnsavedInstruction, isKnowledgeUploading])

  useEffect(() => {
    if (!resetMessage || resetStatus !== 'success') return
    const timerId = window.setTimeout(() => setResetMessage(''), 3500)
    return () => window.clearTimeout(timerId)
  }, [resetMessage, resetStatus])

  if (state.isLoading || knowledgeState.isLoading) {
    return (
      <main className="ai-settings-page" aria-busy="true" aria-label="Загрузка настроек AI">
        <section className="ai-settings-card ai-settings-card--instruction">
          <h1 className="ai-settings-card__title">Инструкция для AI - помощника</h1>
          <div className="ai-settings-skeleton" />
          <div className="ai-settings-skeleton ai-settings-skeleton--button" />
        </section>
        <section className="ai-settings-card ai-settings-card--autopilot">
          <div className="ai-settings-skeleton ai-settings-skeleton--short" />
        </section>
        <section className="ai-settings-card ai-settings-card--knowledge">
          <div className="ai-settings-skeleton ai-settings-skeleton--wide" />
          <div className="ai-settings-skeleton ai-settings-skeleton--wide" />
        </section>
      </main>
    )
  }

  if (state.error || !state.settings) {
    return (
      <main className="ai-settings-page">
        <section className="ai-settings-card ai-settings-card--instruction">
          <h1 className="ai-settings-card__title">Ошибка загрузки</h1>
          <p className="ai-settings-card__text">
            {state.error || 'Не удалось загрузить настройки. Обновите страницу.'}
          </p>
        </section>
      </main>
    )
  }

  const { settings } = state
  const isInstructionTooLong = instruction.length > MAX_INSTRUCTION_LENGTH
  const canSaveInstruction = hasUnsavedInstruction && !isInstructionTooLong && !isInstructionSaving
  const knowledgeTotalPages = Math.max(1, Math.ceil(knowledgeState.total / KNOWLEDGE_PAGE_SIZE))
  const currentStorage: ApiKnowledgeStorage = knowledgeState.storage ?? {
    used_bytes: settings.storage.used_bytes,
    limit_bytes: settings.storage.max_bytes,
    files_count: settings.storage.files_count,
    files_limit: settings.storage.max_files,
  }
  const isKnowledgeStorageFull = (
    currentStorage.used_bytes >= currentStorage.limit_bytes
    || currentStorage.files_count >= currentStorage.files_limit
  )
  const hasKnowledgeRows = knowledgeState.files.length > 0 || pendingKnowledgeUploads.length > 0

  const refreshKnowledgeFiles = async (
    page = knowledgePage,
    search = knowledgeSearch,
    sort = knowledgeSort,
  ) => {
    const response = await getKnowledgeFiles(page, KNOWLEDGE_PAGE_SIZE, search, sort)
    setKnowledgePage(response.page)
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
    setResetStatus('idle')
    setResetMessage('')

    try {
      const updatedSettings = await updateAiSettings({ version: settings.version, instruction })
      setState({ settings: updatedSettings, isLoading: false, error: '' })
      setInstruction(updatedSettings.instruction)
      setInitialInstruction(updatedSettings.instruction)
      setSaveStatus('success')
      setSaveMessage('Изменения сохранены')
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось сохранить инструкцию. Попробуйте позже.',
      )
    } finally {
      setIsInstructionSaving(false)
    }
  }

  const updateAutopilot = async (isEnabled: boolean) => {
    if (isAutopilotSaving) return

    setIsAutopilotSaving(true)
    setAutopilotStatus('idle')
    setAutopilotMessage('')
    setResetStatus('idle')
    setResetMessage('')

    try {
      const updatedSettings = await updateAiSettings({
        version: settings.version,
        autopilot_enabled: isEnabled,
      })
      setState({ settings: updatedSettings, isLoading: false, error: '' })
      setAutopilotStatus('success')
      setAutopilotMessage('Настройки автопилота сохранены')
    } catch (error) {
      setAutopilotStatus('error')
      setAutopilotMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось изменить состояние автопилота. Попробуйте позже.',
      )
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
    } else {
      setIsAutopilotConfirmOpen(true)
    }
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
      setKnowledgeUploadMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить список документов. Обновите страницу.',
      )
    } finally {
      setIsKnowledgeRefreshing(false)
    }
  }

  const handleKnowledgeSearchSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isKnowledgeRefreshing) return

    const nextSearch = knowledgeSearchDraft.trim()
    setKnowledgeSearch(nextSearch)
    setIsKnowledgeRefreshing(true)
    setKnowledgeUploadStatus('idle')
    setKnowledgeUploadMessage('')

    try {
      await refreshKnowledgeFiles(1, nextSearch, knowledgeSort)
    } catch (error) {
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить список документов. Обновите страницу.',
      )
    } finally {
      setIsKnowledgeRefreshing(false)
    }
  }

  const handleKnowledgeSearchClear = async () => {
    if (isKnowledgeRefreshing) return
    setKnowledgeSearchDraft('')
    setKnowledgeSearch('')
    setIsKnowledgeRefreshing(true)

    try {
      await refreshKnowledgeFiles(1, '', knowledgeSort)
    } catch (error) {
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить список документов. Обновите страницу.',
      )
    } finally {
      setIsKnowledgeRefreshing(false)
    }
  }

  const handleKnowledgeSortChange = async (nextSort: ApiKnowledgeSort) => {
    if (isKnowledgeRefreshing || nextSort === knowledgeSort) return
    setKnowledgeSort(nextSort)
    setIsKnowledgeRefreshing(true)

    try {
      await refreshKnowledgeFiles(1, knowledgeSearch, nextSort)
    } catch (error) {
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить список документов. Обновите страницу.',
      )
    } finally {
      setIsKnowledgeRefreshing(false)
    }
  }

  const handleKnowledgePageChange = async (page: number) => {
    if (
      isKnowledgeRefreshing
      || page < 1
      || page > knowledgeTotalPages
      || page === knowledgePage
    ) return

    setIsKnowledgeRefreshing(true)
    setKnowledgeUploadStatus('idle')
    setKnowledgeUploadMessage('')

    try {
      await refreshKnowledgeFiles(page)
    } catch (error) {
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить список документов. Обновите страницу.',
      )
    } finally {
      setIsKnowledgeRefreshing(false)
    }
  }

  const handleKnowledgeFilesUpload = async (files: File[]) => {
    if (files.length === 0 || isKnowledgeUploading) return

    if (isKnowledgeStorageFull) {
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(KNOWLEDGE_STORAGE_FULL_MESSAGE)
      return
    }

    const validationError = validateKnowledgeFiles(files)
    if (validationError) {
      setIsKnowledgeDragActive(false)
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(validationError)
      if (knowledgeFileInputRef.current) knowledgeFileInputRef.current.value = ''
      return
    }

    const pending = files.map((file, index) => ({
      id: `upload-${Date.now()}-${index}`,
      name: file.name,
      size: file.size,
    }))
    const controller = new AbortController()
    uploadControllerRef.current = controller
    setPendingKnowledgeUploads(pending)
    setIsKnowledgeUploading(true)
    setIsKnowledgeDragActive(false)
    setKnowledgeUploadStatus('idle')
    setKnowledgeUploadMessage('')

    try {
      const uploadResponse = await uploadKnowledgeFiles(files, controller.signal)
      if (controller.signal.aborted) return
      setPendingKnowledgeUploads([])
      await refreshKnowledgeFiles(1)
      setKnowledgeUploadStatus('success')
      setKnowledgeUploadMessage(`Загружено файлов: ${uploadResponse.accepted}`)
    } catch (error) {
      setPendingKnowledgeUploads([])
      if (controller.signal.aborted) return
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить файл. Попробуйте позже.',
      )
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null
      }
      setIsKnowledgeUploading(false)
      setIsKnowledgeDragActive(false)
      if (knowledgeFileInputRef.current) knowledgeFileInputRef.current.value = ''
    }
  }

  const handleKnowledgeDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = isKnowledgeUploading || isKnowledgeStorageFull ? 'none' : 'copy'
    if (!isKnowledgeUploading && !isKnowledgeStorageFull) setIsKnowledgeDragActive(true)
  }

  const handleKnowledgeDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setIsKnowledgeDragActive(false)
  }

  const handleKnowledgeDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsKnowledgeDragActive(false)
    if (!isKnowledgeUploading && !isKnowledgeStorageFull) {
      void handleKnowledgeFilesUpload(Array.from(event.dataTransfer.files))
    }
  }

  const requestKnowledgeFileDelete = (file: ApiKnowledgeDocument) => {
    if (deletingKnowledgeFileId || retryingKnowledgeFileId) return
    setDeleteTarget(file)
  }

  const confirmKnowledgeFileDelete = async () => {
    if (!deleteTarget || deletingKnowledgeFileId || retryingKnowledgeFileId) return

    const file = deleteTarget
    setDeletingKnowledgeFileId(file.id)
    setKnowledgeUploadStatus('idle')
    setKnowledgeUploadMessage('')

    try {
      await deleteKnowledgeFile(file.id)
      setDeleteTarget(null)
      const nextPage = knowledgeState.files.length === 1 && knowledgePage > 1
        ? knowledgePage - 1
        : knowledgePage
      await refreshKnowledgeFiles(nextPage)
      setKnowledgeUploadStatus('success')
      setKnowledgeUploadMessage('Файл удалён')
    } catch (error) {
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(
        error instanceof Error ? error.message : 'Не удалось удалить файл. Попробуйте позже.',
      )
    } finally {
      setDeletingKnowledgeFileId(null)
    }
  }

  const handleKnowledgeFileRetry = async (file: ApiKnowledgeDocument) => {
    if (retryingKnowledgeFileId || deletingKnowledgeFileId || file.status !== 'failed') return

    setRetryingKnowledgeFileId(file.id)
    setKnowledgeUploadStatus('idle')
    setKnowledgeUploadMessage('')

    try {
      await retryKnowledgeFile(file.id)
      await refreshKnowledgeFiles()
      setKnowledgeUploadStatus('success')
      setKnowledgeUploadMessage('Повторная обработка запущена')
    } catch (error) {
      setKnowledgeUploadStatus('error')
      setKnowledgeUploadMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось повторить обработку документа. Попробуйте позже.',
      )
    } finally {
      setRetryingKnowledgeFileId(null)
    }
  }

  const handleSettingsReset = async () => {
    if (isResetSaving) return

    setIsResetSaving(true)
    setResetStatus('idle')
    setResetMessage('')
    setSaveStatus('idle')
    setSaveMessage('')
    setAutopilotStatus('idle')
    setAutopilotMessage('')

    try {
      const updatedSettings = await resetAiSettings(settings.version)
      setState({ settings: updatedSettings, isLoading: false, error: '' })
      setInstruction(updatedSettings.instruction)
      setInitialInstruction(updatedSettings.instruction)
      setResetStatus('success')
      setResetMessage('Настройки AI успешно сброшены.')
      setIsResetConfirmOpen(false)
    } catch (error) {
      setResetStatus('error')
      setResetMessage(
        error instanceof Error ? error.message : 'Не удалось сбросить настройки AI. Попробуйте позже.',
      )
      setIsResetConfirmOpen(false)
    } finally {
      setIsResetSaving(false)
    }
  }

  const confirmLeavePage = () => {
    if (!leaveWarning) return
    const href = leaveWarning.href
    if (isKnowledgeUploading) {
      uploadControllerRef.current?.abort()
      setPendingKnowledgeUploads([])
    }
    setLeaveWarning(null)
    window.history.pushState(null, '', href)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <main className="ai-settings-page">
      <section className="ai-settings-card ai-settings-card--instruction">
        <h1 className="ai-settings-card__title">Инструкция для AI - помощника</h1>
        <textarea
          className="ai-settings-instruction-input"
          value={instruction}
          placeholder="Введите инструкцию для AI-помощника"
          maxLength={MAX_INSTRUCTION_LENGTH + 1}
          rows={1}
          disabled={isInstructionSaving}
          onChange={(event) => {
            setInstruction(event.target.value)
            setSaveStatus('idle')
            setSaveMessage('')
            setResetStatus('idle')
            setResetMessage('')
          }}
        />
        <div className="ai-settings-instruction-footer">
          <span className={isInstructionTooLong
            ? 'ai-settings-instruction-counter ai-settings-instruction-counter--error'
            : 'ai-settings-instruction-counter'}>
            {instruction.length}/{MAX_INSTRUCTION_LENGTH}
          </span>
          {saveMessage && (
            <span className={saveStatus === 'error'
              ? 'ai-settings-save-message ai-settings-save-message--error'
              : 'ai-settings-save-message'}>
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
          {isInstructionSaving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </section>

      <section className="ai-settings-card ai-settings-card--autopilot">
        <div className="ai-settings-autopilot-title-row">
          <button
            className={settings.autopilot_enabled
              ? 'ai-settings-switch ai-settings-switch--active'
              : 'ai-settings-switch'}
            type="button"
            aria-label={settings.autopilot_enabled ? 'Выключить автопилот' : 'Включить автопилот'}
            aria-pressed={settings.autopilot_enabled}
            disabled={isAutopilotSaving}
            onClick={handleAutopilotClick}
          >
            <span className="ai-settings-switch__button" />
          </button>
          {isAutopilotSaving && (
            <span className="ai-settings-autopilot-spinner" role="status" aria-label="Сохранение настроек автопилота" />
          )}
          <h2 className="ai-settings-card__title">Автопилот</h2>
        </div>
        <p className="ai-settings-card__text">AI сам отвечает на все входящие сообщения клиентов</p>
        {autopilotMessage && (
          <p className={autopilotStatus === 'error'
            ? 'ai-settings-autopilot-message ai-settings-autopilot-message--error'
            : 'ai-settings-autopilot-message'}>
            {autopilotMessage}
          </p>
        )}
      </section>

      <section className="ai-settings-card ai-settings-card--knowledge">
        <div className="ai-settings-knowledge-header">
          <div>
            <h2 className="ai-settings-card__title">База знаний</h2>
            <p className="ai-settings-card__text">Необходимо, чтобы AI – помощник "поумнел"</p>
          </div>
          <div className="ai-settings-knowledge-actions">
            <span className="ai-settings-storage-summary">
              {formatStorageSummary(currentStorage)}
            </span>
            <button
              className="ai-settings-refresh-button"
              type="button"
              disabled={isKnowledgeRefreshing}
              onClick={() => void handleKnowledgeRefresh()}
            >
              {isKnowledgeRefreshing ? 'Обновляем...' : 'Обновить'}
            </button>
          </div>
        </div>

        <div className="ai-settings-knowledge-toolbar">
          <form className="ai-settings-knowledge-search" onSubmit={(event) => void handleKnowledgeSearchSubmit(event)}>
            <input
              type="search"
              value={knowledgeSearchDraft}
              maxLength={255}
              placeholder="Поиск документов"
              aria-label="Поиск документов базы знаний"
              onChange={(event) => setKnowledgeSearchDraft(event.target.value)}
            />
            <button type="submit" disabled={isKnowledgeRefreshing}>Найти</button>
            {(knowledgeSearch || knowledgeSearchDraft) && (
              <button type="button" disabled={isKnowledgeRefreshing} onClick={() => void handleKnowledgeSearchClear()}>
                Сбросить
              </button>
            )}
          </form>
          <label className="ai-settings-knowledge-sort">
            <span>Сортировка</span>
            <select
              value={knowledgeSort}
              disabled={isKnowledgeRefreshing}
              onChange={(event) => void handleKnowledgeSortChange(event.target.value as ApiKnowledgeSort)}
            >
              <option value="uploaded_at:desc">Сначала новые</option>
              <option value="uploaded_at:asc">Сначала старые</option>
              <option value="name:asc">Название А–Я</option>
              <option value="name:desc">Название Я–А</option>
              <option value="size:asc">Размер по возрастанию</option>
              <option value="size:desc">Размер по убыванию</option>
              <option value="status:asc">Статус А–Я</option>
              <option value="status:desc">Статус Я–А</option>
            </select>
          </label>
        </div>

        {knowledgeState.error && (
          <p className="ai-settings-knowledge-error">{knowledgeState.error}</p>
        )}

        {!knowledgeState.error && hasKnowledgeRows && (
          <div className="ai-settings-knowledge-list">
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
                  {pendingKnowledgeUploads.map((file) => (
                    <tr key={file.id} className="ai-settings-knowledge-row--uploading">
                      <td>{file.name}</td>
                      <td>{formatFileSize(file.size)}</td>
                      <td>—</td>
                      <td>
                        <div className="ai-settings-status-cell">
                          <span className="ai-settings-status-badge ai-settings-status-badge--uploading">Загружается</span>
                          <span className="ai-settings-status-progress" role="progressbar" aria-label={`Загрузка файла ${file.name}`}>
                            <span className="ai-settings-status-progress__bar" />
                          </span>
                        </div>
                      </td>
                      <td>—</td>
                    </tr>
                  ))}
                  {knowledgeState.files.map((file) => (
                    <tr key={file.id}>
                      <td>{file.name}</td>
                      <td>{formatFileSize(file.size)}</td>
                      <td>{formatDate(file.uploaded_at)}</td>
                      <td>
                        <div className="ai-settings-status-cell">
                          <span className={`ai-settings-status-badge ai-settings-status-badge--${file.status}`}>
                            {getKnowledgeStatusLabel(file.status)}
                          </span>
                          {file.status === 'uploading' && (
                            <span className="ai-settings-status-progress" role="progressbar" aria-label={`Загрузка файла ${file.name}`}>
                              <span className="ai-settings-status-progress__bar" />
                            </span>
                          )}
                          {file.status === 'failed' && (
                            <span
                              className="ai-settings-status-info"
                              title={file.error_reason || 'Причина ошибки не указана'}
                              aria-label={`Причина ошибки: ${file.error_reason || 'не указана'}`}
                              tabIndex={0}
                            >
                              ⓘ
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="ai-settings-table-actions">
                          {file.status === 'failed' && (
                            <button
                              className="ai-settings-table-action-button ai-settings-table-action-button--retry"
                              type="button"
                              disabled={retryingKnowledgeFileId === file.id || deletingKnowledgeFileId === file.id}
                              onClick={() => void handleKnowledgeFileRetry(file)}
                            >
                              {retryingKnowledgeFileId === file.id ? 'Повторяем...' : 'Повторить обработку'}
                            </button>
                          )}
                          <button
                            className="ai-settings-table-action-button"
                            type="button"
                            disabled={deletingKnowledgeFileId === file.id || retryingKnowledgeFileId === file.id}
                            onClick={() => requestKnowledgeFileDelete(file)}
                          >
                            {deletingKnowledgeFileId === file.id ? 'Удаляем...' : 'Удалить'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {knowledgeState.total > 0 && (
              <div className="ai-settings-pagination" aria-label="Пагинация документов">
                <button
                  type="button"
                  disabled={knowledgePage <= 1 || isKnowledgeRefreshing}
                  onClick={() => void handleKnowledgePageChange(knowledgePage - 1)}
                >
                  Предыдущая страница
                </button>
                <span>
                  Страница {knowledgePage} из {knowledgeTotalPages} · Показано{' '}
                  {knowledgeState.files.length} из {knowledgeState.total}
                </span>
                <button
                  type="button"
                  disabled={knowledgePage >= knowledgeTotalPages || isKnowledgeRefreshing}
                  onClick={() => void handleKnowledgePageChange(knowledgePage + 1)}
                >
                  Следующая страница
                </button>
              </div>
            )}
          </div>
        )}

        {!knowledgeState.error && knowledgeSearch && knowledgeState.files.length === 0 && pendingKnowledgeUploads.length === 0 && (
          <p className="ai-settings-knowledge-search-empty">По вашему запросу документы не найдены.</p>
        )}

        <div
          className={isKnowledgeDragActive
            ? 'ai-settings-upload-box ai-settings-upload-box--drag-active'
            : 'ai-settings-upload-box'}
          aria-disabled={isKnowledgeStorageFull || isKnowledgeUploading}
          onDragOver={handleKnowledgeDragOver}
          onDragLeave={handleKnowledgeDragLeave}
          onDrop={handleKnowledgeDrop}
        >
          <span className="ai-settings-upload-box__icon" aria-hidden="true">↥</span>
          <span>Чтобы загрузить документ, перетащите его сюда или нажмите</span>
          <input
            className="ai-settings-file-input"
            ref={knowledgeFileInputRef}
            type="file"
            accept={KNOWLEDGE_FILE_ACCEPT}
            multiple
            disabled={isKnowledgeStorageFull || isKnowledgeUploading}
            onChange={(event) => void handleKnowledgeFilesUpload(Array.from(event.target.files ?? []))}
          />
          <button
            className="ai-settings-upload-box__button"
            type="button"
            disabled={isKnowledgeStorageFull || isKnowledgeUploading}
            onClick={() => knowledgeFileInputRef.current?.click()}
          >
            {isKnowledgeUploading ? 'Загрузка...' : 'Загрузить'}
          </button>
        </div>

        {isKnowledgeStorageFull && (
          <p className="ai-settings-upload-message ai-settings-upload-message--error">
            {KNOWLEDGE_STORAGE_FULL_MESSAGE}
          </p>
        )}

        {isKnowledgeUploading && (
          <div className="ai-settings-upload-progress" role="progressbar" aria-label="Загрузка документов">
            <span className="ai-settings-upload-progress__bar" />
          </div>
        )}

        {knowledgeUploadMessage && (
          <p className={knowledgeUploadStatus === 'error'
            ? 'ai-settings-upload-message ai-settings-upload-message--error'
            : 'ai-settings-upload-message'}>
            {knowledgeUploadMessage}
          </p>
        )}
      </section>

      <section className="ai-settings-card ai-settings-card--materials">
        <h2 className="ai-settings-card__title">Полезные материалы</h2>
        <div className="ai-settings-materials">
          <button className="ai-settings-video-button" type="button">
            <span aria-hidden="true">▶</span>
            Смотреть обучающее видео
          </button>
          <a className="ai-settings-guide-link" href={AI_SETUP_GUIDE_URL} target="_blank" rel="noreferrer">
            Читать инструкцию
          </a>
        </div>
      </section>

      <button
        className="ai-settings-reset-button"
        type="button"
        disabled={isResetSaving}
        onClick={() => setIsResetConfirmOpen(true)}
      >
        {isResetSaving ? 'Сбрасываем...' : 'Сброс настроек'}
      </button>

      {resetMessage && (
        <div
          className={resetStatus === 'error'
            ? 'ai-settings-reset-toast ai-settings-reset-toast--error'
            : 'ai-settings-reset-toast'}
          role={resetStatus === 'error' ? 'alert' : 'status'}
        >
          {resetMessage}
        </div>
      )}

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

      {deleteTarget && (
        <div className="ai-settings-modal-backdrop" role="presentation">
          <div className="ai-settings-modal" role="alertdialog" aria-modal="true" aria-labelledby="ai-knowledge-delete-title">
            <h2 className="ai-settings-modal__title" id="ai-knowledge-delete-title">Удалить документ?</h2>
            <p className="ai-settings-modal__text">
              Вы уверены, что хотите удалить файл «{deleteTarget.name}» из базы знаний?
            </p>
            <div className="ai-settings-modal__actions">
              <button
                className="ai-settings-modal__button ai-settings-modal__button--secondary"
                type="button"
                disabled={Boolean(deletingKnowledgeFileId)}
                onClick={() => setDeleteTarget(null)}
              >
                Отмена
              </button>
              <button
                className="ai-settings-modal__button ai-settings-modal__button--primary"
                type="button"
                disabled={Boolean(deletingKnowledgeFileId)}
                onClick={() => void confirmKnowledgeFileDelete()}
              >
                {deletingKnowledgeFileId ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isResetConfirmOpen && (
        <div className="ai-settings-modal-backdrop" role="presentation">
          <div className="ai-settings-modal" role="alertdialog" aria-modal="true" aria-labelledby="ai-reset-confirm-title">
            <h2 className="ai-settings-modal__title" id="ai-reset-confirm-title">Сброс настроек AI</h2>
            <p className="ai-settings-modal__text">
              Вы уверены, что хотите сбросить настройки AI к значениям по умолчанию? База знаний не будет удалена.
            </p>
            <div className="ai-settings-modal__actions">
              <button
                className="ai-settings-modal__button ai-settings-modal__button--secondary"
                type="button"
                disabled={isResetSaving}
                onClick={() => setIsResetConfirmOpen(false)}
              >
                Отмена
              </button>
              <button
                className="ai-settings-modal__button ai-settings-modal__button--primary"
                type="button"
                disabled={isResetSaving}
                onClick={() => void handleSettingsReset()}
              >
                {isResetSaving ? 'Сбрасываем...' : 'Сбросить настройки'}
              </button>
            </div>
          </div>
        </div>
      )}

      {leaveWarning && (
        <div className="ai-settings-modal-backdrop" role="presentation">
          <div className="ai-settings-modal" role="alertdialog" aria-modal="true" aria-labelledby="ai-leave-warning-title">
            <h2 className="ai-settings-modal__title" id="ai-leave-warning-title">Покинуть страницу?</h2>
            <p className="ai-settings-modal__text">{leaveWarning.message}</p>
            <div className="ai-settings-modal__actions">
              <button className="ai-settings-modal__button ai-settings-modal__button--secondary" type="button" onClick={() => setLeaveWarning(null)}>
                Остаться
              </button>
              <button className="ai-settings-modal__button ai-settings-modal__button--primary" type="button" onClick={confirmLeavePage}>
                Покинуть страницу
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function validateKnowledgeFiles(files: File[]) {
  if (files.length > MAX_KNOWLEDGE_FILES_PER_UPLOAD) {
    return 'Можно загружать не более 20 файлов одновременно.'
  }

  for (const file of files) {
    if (file.name.length > MAX_KNOWLEDGE_FILE_NAME_LENGTH) {
      return 'Имя файла не должно превышать 255 символов.'
    }
    if (file.size > MAX_KNOWLEDGE_FILE_SIZE) {
      return 'Размер файла не должен превышать 20 МБ.'
    }
    const extension = getFileExtension(file.name)
    if (!ALLOWED_KNOWLEDGE_FILE_EXTENSIONS.includes(extension)) {
      return 'Поддерживаются только PDF, TXT, DOCX, CSV.'
    }
    if (file.size === 0) {
      return `Файл «${file.name}» пустой.`
    }
  }

  return ''
}

function getFileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split('.')
  return parts.length > 1 ? parts.at(-1) ?? '' : ''
}

function formatStorageSummary(storage: ApiKnowledgeStorage) {
  const used = storage.used_bytes === 0 ? '0 МБ' : formatFileSize(storage.used_bytes)
  return `Использовано: ${used} из ${formatFileSize(storage.limit_bytes)} (${storage.files_count} из ${storage.files_limit} документов)`
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${trimTrailingZero(size / 1024)} КБ`
  if (size < 1024 * 1024 * 1024) return `${trimTrailingZero(size / 1024 / 1024)} МБ`
  return `${trimTrailingZero(size / 1024 / 1024 / 1024)} ГБ`
}

function trimTrailingZero(value: number) {
  const fixed = value.toFixed(1)
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

function getKnowledgeStatusLabel(status: ApiKnowledgeDocument['status']) {
  if (status === 'uploading') return 'Загружается'
  if (status === 'processing') return 'Обработка документа...'
  if (status === 'ready') return 'Готов'
  return 'Ошибка'
}
