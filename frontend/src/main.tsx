import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './PasswordResetModal.mobile.css'
import { AccountDeletedNotice } from './components/AccountDeletedNotice'
import { CrmToastController } from './components/crm/CrmToastController'
import { CrmAppPage } from './pages/CrmAppPage'
import { installAiChatContractController } from './shared/aiChatContractController'
import { installAiSettingsFeedbackController } from './shared/aiSettingsFeedbackController'
import {
  CRM_REALTIME_EVENT,
  CRM_REALTIME_RECONNECTED_EVENT,
  installCrmRealtime,
} from './shared/crmRealtime'
import { installDealsContractController } from './shared/dealsContractController'
import { installDealsTouchDnd } from './shared/dealsTouchDnd'
import { installNotificationDeepLinks } from './shared/notificationDeepLinks'
import { installPendingAiQueryController } from './shared/pendingAiQuery'
import { installTasksTouchDnd } from './shared/tasksTouchDnd'

installNotificationDeepLinks()
installAiChatContractController()
installPendingAiQueryController()
installAiSettingsFeedbackController()
installCrmRealtime()
installTasksTouchDnd()
installDealsTouchDnd()
installDealsContractController()

const AI_SETTINGS_SPEC_PATH = '/settings/ai'
const AI_SETTINGS_APP_PATH = '/app/settings/ai'
const CRM_ROOT_PATHS = new Set(['/profile', '/notifications'])

if (window.location.pathname === AI_SETTINGS_SPEC_PATH) {
  window.history.replaceState(
    null,
    '',
    `${AI_SETTINGS_APP_PATH}${window.location.search}${window.location.hash}`,
  )
}

const root = createRoot(document.getElementById('root')!)
let appRevision = 0
let pendingRealtimeRefresh = false
let pendingRefreshTimer: number | null = null

function renderApplication() {
  const rootPage = CRM_ROOT_PATHS.has(window.location.pathname)
    ? <CrmAppPage />
    : <App />

  root.render(
    <StrictMode key={appRevision}>
      <>
        {rootPage}
        <AccountDeletedNotice />
        <CrmToastController />
      </>
    </StrictMode>,
  )
}

function isTaskRealtimeEvent(event: Event) {
  if (!(event instanceof CustomEvent)) {
    return false
  }

  const eventName = (event.detail as { event?: unknown } | null)?.event
  return (
    eventName === 'task_created' ||
    eventName === 'task_updated' ||
    eventName === 'task_deleted' ||
    eventName === 'tasks_bulk_deleted'
  )
}

function isTaskAwarePage() {
  return window.location.pathname === '/app' || window.location.pathname === '/app/tasks'
}

function requestRealtimeRefresh() {
  if (!isTaskAwarePage()) {
    return
  }

  if (document.querySelector('.task-form-overlay, .tasks-delete-overlay, .dashboard-delete-overlay')) {
    pendingRealtimeRefresh = true
    schedulePendingRefreshCheck()
    return
  }

  pendingRealtimeRefresh = false
  appRevision += 1
  renderApplication()
}

function schedulePendingRefreshCheck() {
  if (pendingRefreshTimer !== null) {
    return
  }

  pendingRefreshTimer = window.setTimeout(() => {
    pendingRefreshTimer = null

    if (!pendingRealtimeRefresh || !isTaskAwarePage()) {
      pendingRealtimeRefresh = false
      return
    }

    if (document.querySelector('.task-form-overlay, .tasks-delete-overlay, .dashboard-delete-overlay')) {
      schedulePendingRefreshCheck()
      return
    }

    requestRealtimeRefresh()
  }, 250)
}

window.addEventListener(CRM_REALTIME_EVENT, (event) => {
  if (isTaskRealtimeEvent(event)) {
    requestRealtimeRefresh()
  }
})

window.addEventListener(CRM_REALTIME_RECONNECTED_EVENT, () => {
  requestRealtimeRefresh()
})

renderApplication()
