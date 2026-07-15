import { useEffect, useState } from 'react'
import { CrmLayout } from '../components/crm/CrmLayout'
import { UserMenu } from '../components/crm/UserMenu'
import { refreshSession } from '../shared/api/authApi'
import { ProfilePage } from './ProfilePage'

type AuthStatus = 'checking' | 'authorized' | 'unauthorized'

export function CrmAppPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')

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

  if (window.location.pathname === '/profile') {
    return <ProfilePage />
  }

  return (
    <>
      <CrmLayout />
      <UserMenu />
    </>
  )
}
