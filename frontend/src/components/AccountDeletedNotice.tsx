import { useEffect, useState } from 'react'
import './AccountDeletedNotice.css'

const ACCOUNT_DELETED_QUERY = 'account_deleted'
const ACCOUNT_DELETED_MESSAGE_KEY = 'account_deleted_message'

export function AccountDeletedNotice() {
  const [message, setMessage] = useState('')

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)

    if (searchParams.get(ACCOUNT_DELETED_QUERY) !== '1') {
      return
    }

    const storedMessage = sessionStorage.getItem(ACCOUNT_DELETED_MESSAGE_KEY)
    setMessage(storedMessage || 'Ваша учётная запись удалена')
    sessionStorage.removeItem(ACCOUNT_DELETED_MESSAGE_KEY)

    searchParams.delete(ACCOUNT_DELETED_QUERY)
    const nextSearch = searchParams.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
    )

    const loginTimerId = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('.loginButton')?.click()
    }, 100)

    const hideTimerId = window.setTimeout(() => setMessage(''), 4500)

    return () => {
      window.clearTimeout(loginTimerId)
      window.clearTimeout(hideTimerId)
    }
  }, [])

  if (!message) {
    return null
  }

  return (
    <div className="account-deleted-notice" role="status">
      {message}
    </div>
  )
}
