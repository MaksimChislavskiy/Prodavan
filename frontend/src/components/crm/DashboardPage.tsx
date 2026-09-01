import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getAllOnboardingKnowledgeFiles,
  getOnboardingStatus,
  type ApiOnboardingStatus,
} from '../../shared/api/onboardingApi'
import {
  CRM_REALTIME_EVENT,
  CRM_REALTIME_RECONNECTED_EVENT,
} from '../../shared/crmRealtime'
import { showCrmToast } from '../../shared/crmToast'
import { DashboardPage as MainDashboardPage } from './DashboardPageV2'
import { OnboardingDashboard } from './OnboardingDashboard'
import type { ApiKnowledgeDocument } from '../../shared/api/aiSettingsApi'
import './OnboardingDashboard.css'

type DashboardPhase = 'loading' | 'onboarding' | 'completing' | 'dashboard' | 'error'
type CompletionSource = 'initial' | 'onboarding' | null

type DashboardPageProps = {
  onShowAll: () => void
}

export function DashboardPage({ onShowAll }: DashboardPageProps) {
  const statusRef = useRef<ApiOnboardingStatus | null>(null)
  const completionTimerRef = useRef<number | null>(null)
  const completionSourceRef = useRef<CompletionSource>(null)
  const [phase, setPhase] = useState<DashboardPhase>('loading')
  const [status, setStatus] = useState<ApiOnboardingStatus | null>(null)
  const [initialFiles, setInitialFiles] = useState<ApiKnowledgeDocument[]>([])

  const applyStatus = useCallback((next: ApiOnboardingStatus, initial = false) => {
    const previous = statusRef.current
    if (previous?.status === 'completed' && next.status !== 'completed') {
      return
    }

    statusRef.current = next
    setStatus(next)

    if (next.status !== 'completed') {
      completionSourceRef.current = null
      setPhase('onboarding')
      return
    }

    if (previous?.status === 'completed') {
      setPhase('dashboard')
      return
    }

    if (completionTimerRef.current !== null) return
    completionSourceRef.current = initial ? 'initial' : 'onboarding'
    setPhase('completing')
    showCrmToast('Онбординг завершён!')
    completionTimerRef.current = window.setTimeout(() => {
      completionTimerRef.current = null
      completionSourceRef.current = null
      setPhase('dashboard')
    }, 1500)
  }, [])

  useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const initialStatus = await getOnboardingStatus()
        if (disposed) return

        if (initialStatus.status === 'completed') {
          applyStatus(initialStatus, true)
          return
        }

        const files = await getAllOnboardingKnowledgeFiles()
        if (disposed || statusRef.current?.status === 'completed') return
        setInitialFiles(files)
        statusRef.current = initialStatus
        setStatus(initialStatus)
        setPhase('onboarding')
      } catch {
        if (!disposed) setPhase('error')
      }
    })()

    return () => {
      disposed = true
    }
  }, [applyStatus])

  useEffect(() => {
    const syncStatus = async () => {
      try {
        applyStatus(await getOnboardingStatus())
      } catch {
        // Keep the last server-confirmed state; the next reconnect/event retries sync.
      }
    }

    const handleRealtime = (event: Event) => {
      const payload = (event as CustomEvent<unknown>).detail
      if (!payload || typeof payload !== 'object') return
      const eventName = 'event' in payload ? (payload as { event?: unknown }).event : undefined
      if (eventName !== 'onboarding_status_updated') return
      const data = 'data' in payload ? (payload as { data?: unknown }).data : undefined
      if (!isOnboardingStatus(data)) return
      applyStatus(data)
    }

    const handleReconnect = () => {
      void syncStatus()
    }

    window.addEventListener(CRM_REALTIME_EVENT, handleRealtime)
    window.addEventListener(CRM_REALTIME_RECONNECTED_EVENT, handleReconnect)
    return () => {
      window.removeEventListener(CRM_REALTIME_EVENT, handleRealtime)
      window.removeEventListener(CRM_REALTIME_RECONNECTED_EVENT, handleReconnect)
    }
  }, [applyStatus])

  useEffect(() => () => {
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current)
    }
  }, [])

  if (phase === 'dashboard') {
    return <MainDashboardPage onShowAll={onShowAll} />
  }

  if (phase === 'error') {
    return (
      <section className="onboarding-entry-error" role="alert">
        Не удалось загрузить рабочий стол. Обновите страницу.
      </section>
    )
  }

  if (
    phase === 'loading'
    || !status
    || (phase === 'completing' && completionSourceRef.current === 'initial')
  ) {
    return <DashboardSkeleton />
  }

  return (
    <OnboardingDashboard
      status={status}
      initialFiles={initialFiles}
      onStatusChange={(next) => applyStatus(next)}
    />
  )
}

function DashboardSkeleton() {
  return (
    <div className="onboarding-entry-skeleton" aria-label="Загрузка рабочего стола" aria-busy="true">
      <span />
      <span />
      <span />
    </div>
  )
}

function isOnboardingStatus(value: unknown): value is ApiOnboardingStatus {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ApiOnboardingStatus>
  if (
    candidate.version !== 1
    || !['not_started', 'in_progress', 'completed'].includes(candidate.status ?? '')
    || !candidate.steps
    || typeof candidate.steps.knowledge_base_completed !== 'boolean'
    || typeof candidate.steps.materials_viewed !== 'boolean'
  ) return false
  return candidate.completed_at === null || typeof candidate.completed_at === 'string'
}
