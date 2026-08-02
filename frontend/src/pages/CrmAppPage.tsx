import { useEffect, useState } from 'react'
import { AccountDeleteController } from '../components/crm/AccountDeleteController'
import { CrmLayout } from '../components/crm/CrmLayout'
import { NotificationCenterController } from '../components/crm/NotificationCenterController'
import { UserMenu } from '../components/crm/UserMenu'
import { refreshSession } from '../shared/api/authApi'
import { ProfilePage } from './ProfilePage'

type AuthStatus = 'checking' | 'authorized' | 'unauthorized'

export function CrmAppPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')
  const [currentPath, setCurrentPath] = useState(window.location.pathname)

  useEffect(() => {
    let isMounted = true

    async function checkSession() {
      try {
        await refreshSession()

        if (isMounted) {
          setAuthStatus('authorized')
        }
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
      <NotificationCenterController />
      {currentPath === '/profile' && <ProfilePage />}
      <UserMenu />
      <AccountDeleteController />
    </>
  )
}
