import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import {
  getAllOnboardingKnowledgeFiles,
  markOnboardingMaterialViewed,
  type ApiOnboardingStatus,
} from '../../shared/api/onboardingApi'
import {
  uploadKnowledgeFiles,
  type ApiKnowledgeDocument,
} from '../../shared/api/aiSettingsApi'
import {
  CRM_REALTIME_EVENT,
  CRM_REALTIME_RECONNECTED_EVENT,
} from '../../shared/crmRealtime'
import { showCrmToast } from '../../shared/crmToast'
import { AiSetupVideoModal } from './AiSetupVideoModal'
import './OnboardingDashboard.css'

const MAX_FILES_PER_UPLOAD = 20
const AI_SETUP_VIDEO_URL = (import.meta.env.VITE_AI_SETUP_VIDEO_URL ?? '').trim()
const AI_SETUP_GUIDE_URL = '/static/ai_setup_guide.pdf'
const FILE_ACCEPT = '.pdf,.txt,.docx,.csv,application/pdf,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const LEAVE_WARNING = 'Загрузка документов ещё не завершена. Покинуть страницу?'
const ALL_FAILED_MESSAGE = 'Не удалось обработать документы. Загрузите файлы повторно или перейдите в Настройки AI для диагностики.'

type LeaveWarning =
  | { action: 'navigate'; href: string }
  | { action: 'reload' }
  | null

type OnboardingDashboardProps = {
  status: ApiOnboardingStatus
  initialFiles: ApiKnowledgeDocument[]
  onStatusChange: (status: ApiOnboardingStatus) => void
}

export function OnboardingDashboard({
  status,
  initialFiles,
  onStatusChange,
}: OnboardingDashboardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadControllerRef = useRef<AbortController | null>(null)
  const allowUnloadRef = useRef(false)
  const [files, setFiles] = useState<ApiKnowledgeDocument[]>(initialFiles)
  const [isFilesRefreshing, setIsFilesRefreshing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isVideoOpen, setIsVideoOpen] = useState(false)
  const [leaveWarning, setLeaveWarning] = useState<LeaveWarning>(null)

  const refreshFiles = useCallback(async () => {
    if (isFilesRefreshing) return
    setIsFilesRefreshing(true)
    try {
      setFiles(await getAllOnboardingKnowledgeFiles())
    } catch {
      // Current server state remains visible; reconnect or the next event retries sync.
    } finally {
      setIsFilesRefreshing(false)
    }
  }, [isFilesRefreshing])

  useEffect(() => {
    const handleRealtime = (event: Event) => {
      const payload = (event as CustomEvent<unknown>).detail
      if (!payload || typeof payload !== 'object') return
      const eventName = 'event' in payload ? (payload as { event?: unknown }).event : undefined
      if (
        eventName === 'knowledge_document_created'
        || eventName === 'knowledge_document_status'
        || eventName === 'knowledge_document_deleted'
      ) {
        void refreshFiles()
      }
    }

    const handleReconnect = () => {
      void refreshFiles()
    }

    window.addEventListener(CRM_REALTIME_EVENT, handleRealtime)
    window.addEventListener(CRM_REALTIME_RECONNECTED_EVENT, handleReconnect)
    return () => {
      window.removeEventListener(CRM_REALTIME_EVENT, handleRealtime)
      window.removeEventListener(CRM_REALTIME_RECONNECTED_EVENT, handleReconnect)
    }
  }, [refreshFiles])

  useEffect(() => {
    if (!isUploading) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowUnloadRef.current) return
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
      ) return

      event.preventDefault()
      event.stopPropagation()
      setLeaveWarning({
        action: 'navigate',
        href: `${url.pathname}${url.search}${url.hash}`,
      })
    }

    const handleReloadKeyDown = (event: KeyboardEvent) => {
      const isReload = (
        event.key === 'F5'
        || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')
      )
      if (!isReload) return
      event.preventDefault()
      event.stopPropagation()
      setLeaveWarning({ action: 'reload' })
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleInternalLinkClick, true)
    window.addEventListener('keydown', handleReloadKeyDown, true)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleInternalLinkClick, true)
      window.removeEventListener('keydown', handleReloadKeyDown, true)
    }
  }, [isUploading])

  useEffect(() => () => {
    uploadControllerRef.current?.abort()
  }, [])

  const recordMaterial = async (material: 'video' | 'pdf') => {
    try {
      onStatusChange(await markOnboardingMaterialViewed(material))
    } catch (error) {
      showCrmToast(
        error instanceof Error
          ? error.message
          : 'Не удалось сохранить прогресс онбординга. Попробуйте позже.',
      )
    }
  }

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selected.length === 0 || isUploading) return

    if (selected.length > MAX_FILES_PER_UPLOAD) {
      showCrmToast('За один раз можно загрузить не более 20 файлов.')
      return
    }

    const controller = new AbortController()
    uploadControllerRef.current = controller
    setIsUploading(true)
    setUploadProgress(0)

    try {
      const response = await uploadKnowledgeFiles(
        selected,
        controller.signal,
        setUploadProgress,
      )
      if (controller.signal.aborted) return
      setFiles((current) => {
        const ids = new Set(response.files.map((file) => file.id))
        return [...response.files, ...current.filter((file) => !ids.has(file.id))]
      })
      await refreshFiles()
    } catch (error) {
      if (!controller.signal.aborted) {
        showCrmToast(
          error instanceof Error
            ? error.message
            : 'Не удалось загрузить файл. Попробуйте позже.',
        )
      }
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null
      }
      setIsUploading(false)
      setUploadProgress(0)
    }
  }

  const confirmLeave = () => {
    if (!leaveWarning) return
    const target = leaveWarning
    uploadControllerRef.current?.abort()
    setLeaveWarning(null)

    if (target.action === 'reload') {
      allowUnloadRef.current = true
      window.location.reload()
      return
    }

    window.history.pushState(null, '', target.href)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const hasReady = status.steps.knowledge_base_completed
  const hasProcessing = !hasReady && (
    isUploading
    || files.some((file) => file.status === 'uploading' || file.status === 'processing')
  )
  const allFailed = !hasReady
    && files.length > 0
    && files.every((file) => file.status === 'failed')
  const showUploadButton = !hasReady && !hasProcessing

  return (
    <div className="onboarding-dashboard">
      <section className="onboarding-welcome">
        <h1>Продаван — CRM на основе AI</h1>
        <p>Для тех, кто хочет продавать, а не настраивать системы</p>
      </section>

      <section className="onboarding-progress" aria-label="Прогресс онбординга">
        <div className={status.steps.knowledge_base_completed ? 'onboarding-step onboarding-step--done' : 'onboarding-step'}>
          <span aria-hidden="true">{status.steps.knowledge_base_completed ? '✓' : '○'}</span>
          <span>База знаний загружена</span>
        </div>
        <div className={status.steps.materials_viewed ? 'onboarding-step onboarding-step--done' : 'onboarding-step'}>
          <span aria-hidden="true">{status.steps.materials_viewed ? '✓' : '○'}</span>
          <span>Обучающие материалы просмотрены</span>
        </div>
      </section>

      <section className="onboarding-card">
        <h2>Загрузите Базу знаний для обучения AI</h2>
        <p>Для быстрого и эффективного управления внутренними процессами и работы с клиентами.</p>

        {hasReady && (
          <p className="onboarding-knowledge-state onboarding-knowledge-state--success">
            ✓ База знаний загружена
          </p>
        )}

        {hasProcessing && (
          <div className="onboarding-processing" role="status">
            <span>Обработка документов...</span>
            {isUploading && (
              <div
                className="onboarding-upload-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress}
                aria-label="Загрузка документов"
              >
                <span style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
          </div>
        )}

        {allFailed && (
          <p className="onboarding-knowledge-state onboarding-knowledge-state--error">
            {ALL_FAILED_MESSAGE}
          </p>
        )}

        {showUploadButton && (
          <>
            <input
              ref={fileInputRef}
              className="onboarding-file-input"
              type="file"
              accept={FILE_ACCEPT}
              multiple
              onChange={(event) => void handleFilesSelected(event)}
            />
            <button
              className="onboarding-primary-button"
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? 'Загрузка...' : 'Загрузить'}
            </button>
          </>
        )}
      </section>

      <section className="onboarding-card">
        <h2>Краткое видео и инструкция для простой и быстрой настройки AI в CRM</h2>
        <div className="onboarding-material-actions">
          <button
            className="onboarding-primary-button"
            type="button"
            onClick={() => {
              setIsVideoOpen(true)
              if (AI_SETUP_VIDEO_URL) void recordMaterial('video')
            }}
          >
            <span aria-hidden="true">▶</span>
            Смотреть
          </button>
          <a
            className="onboarding-secondary-button"
            href={AI_SETUP_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => void recordMaterial('pdf')}
          >
            Читать инструкцию
          </a>
        </div>
      </section>

      <AiSetupVideoModal
        isOpen={isVideoOpen}
        videoUrl={AI_SETUP_VIDEO_URL}
        onClose={() => setIsVideoOpen(false)}
      />

      {leaveWarning && (
        <div className="onboarding-modal-backdrop" role="presentation">
          <div
            className="onboarding-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="onboarding-leave-title"
          >
            <h2 id="onboarding-leave-title">Покинуть страницу?</h2>
            <p>{LEAVE_WARNING}</p>
            <div className="onboarding-modal__actions">
              <button type="button" onClick={() => setLeaveWarning(null)}>Остаться</button>
              <button type="button" onClick={confirmLeave}>Покинуть страницу</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
