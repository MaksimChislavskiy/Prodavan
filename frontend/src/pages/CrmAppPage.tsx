import { useEffect, useState } from 'react'
import { AccountDeleteController } from '../components/crm/AccountDeleteController'
import { CrmLayout } from '../components/crm/CrmLayout'
import { CrmObjectDeepLinkController } from '../components/crm/CrmObjectDeepLinkController'
import { NotificationCenterController } from '../components/crm/NotificationCenterController'
import { SidebarAiChatController } from '../components/crm/SidebarAiChatController'
import { UserMenu } from '../components/crm/UserMenu'
import {
  getCurrentUser,
  refreshSession,
  type CurrentUserRole,
} from '../shared/api/authApi'
import { ProfilePage } from './ProfilePage'
import './CrmRoleAccess.css'

type AuthStatus = 'checking' | 'authorized' | 'unauthorized'

const AI_SETTINGS_PATH = '/app/settings/ai'

export function CrmAppPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')
  const [currentPath, setCurrentPath] = useState(window.location.pathname)
  const [currentRole, setCurrentRole] = useState<CurrentUserRole | null>(null)

  useEffect(() => {
    let isMounted = true

    async function checkSession() {
      try {
        await refreshSession()
        const currentUser = await getCurrentUser()

        if (!isMounted) {
          return
        }

        setCurrentRole(currentUser.role)
        document.documentElement.dataset.crmRole = currentUser.role

        if (currentUser.role !== 'admin' && window.location.pathname === AI_SETTINGS_PATH) {
          window.history.replaceState(null, '', '/app')
          setCurrentPath('/app')
        }

        setAuthStatus('authorized')
      } catch {
        if (isMounted) {
          setAuthStatus('unauthorized')
          window.location.href = '/'
        }
      }
    }

    void checkSession()

    return () => {
      isMounted = false
      delete document.documentElement.dataset.crmRole
    }
  }, [])

  useEffect(() => {
    const handlePathChange = () => {
      setCurrentPath(window.location.pathname)
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      const link = target.closest<HTMLAnchorElement>('a[href]')

      if (!link || link.origin !== window.location.origin) {
        return
      }

      window.setTimeout(handlePathChange, 0)
    }

    window.addEventListener('popstate', handlePathChange)
    document.addEventListener('click', handleDocumentClick)

    return () => {
      window.removeEventListener('popstate', handlePathChange)
      document.removeEventListener('click', handleDocumentClick)
    }
  }, [])

  useEffect(() => {
    if (
      authStatus !== 'authorized'
      || currentRole === null
      || currentRole === 'admin'
      || currentPath !== AI_SETTINGS_PATH
    ) {
      return
    }

    window.history.replaceState(null, '', '/app')
    setCurrentPath('/app')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [authStatus, currentPath, currentRole])

  if (authStatus === 'checking') {
    return (
      <div style={{ padding: 32, fontFamily: 'Inter, Arial, sans-serif' }}>
        Проверяем сессию...
      </div>
    )
  }

  if (authStatus === 'unauthorized') {
    return null
  }

  return (
    <>
      <CrmLayout />
      <CrmObjectDeepLinkController />
      <NotificationCenterController />
      <SidebarAiChatController />
      {currentPath === '/profile' && <ProfilePage />}
      <UserMenu />
      <AccountDeleteController />
    </>
  )
}
