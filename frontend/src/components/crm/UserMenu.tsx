import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { logoutSession } from '../../shared/api/authApi'
import { clearAccessToken } from '../../shared/api/authToken'
import './UserMenu.css'

const USER_MENU_WIDTH = 340
const USER_MENU_OFFSET = 12
const VIEWPORT_GAP = 20

export function UserMenu() {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const profileButtonRef = useRef<HTMLButtonElement | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({})
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  const updateMenuPosition = (button: HTMLButtonElement) => {
    const buttonRect = button.getBoundingClientRect()
    const left = Math.max(
      VIEWPORT_GAP,
      Math.min(
        buttonRect.right - USER_MENU_WIDTH,
        window.innerWidth - USER_MENU_WIDTH - VIEWPORT_GAP,
      ),
    )

    setMenuPosition({
      top: buttonRect.bottom + USER_MENU_OFFSET,
      left,
    })
  }

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      const profileButton = target.closest<HTMLButtonElement>('.crm-profile-button')

      if (profileButton) {
        profileButtonRef.current = profileButton
        updateMenuPosition(profileButton)
        setIsMenuOpen((currentValue) => !currentValue)
        return
      }

      if (menuRef.current?.contains(target)) {
        return
      }

      setIsMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      if (isLogoutConfirmOpen && !isLoggingOut) {
        setIsLogoutConfirmOpen(false)
        setLogoutError('')
        return
      }

      setIsMenuOpen(false)
    }

    const handleWindowResize = () => {
      if (isMenuOpen && profileButtonRef.current) {
        updateMenuPosition(profileButtonRef.current)
      }
    }

    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleWindowResize)

    return () => {
      document.removeEventListener('click', handleDocumentClick)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [isLogoutConfirmOpen, isLoggingOut, isMenuOpen])

  useEffect(() => {
    const button = profileButtonRef.current

    if (!button) {
      return
    }

    button.setAttribute('aria-expanded', String(isMenuOpen))
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-controls', 'crm-user-menu')
  }, [isMenuOpen])

  const openProfile = () => {
    setIsMenuOpen(false)

    if (window.location.pathname === '/profile') {
      return
    }

    window.location.href = '/profile'
  }

  const openLogoutConfirm = () => {
    setIsMenuOpen(false)
    setLogoutError('')
    setIsLogoutConfirmOpen(true)
  }

  const closeLogoutConfirm = () => {
    if (isLoggingOut) {
      return
    }

    setIsLogoutConfirmOpen(false)
    setLogoutError('')
  }

  const handleLogout = async () => {
    if (isLoggingOut) {
      return
    }

    setIsLoggingOut(true)
    setLogoutError('')

    try {
      await logoutSession()
      clearAccessToken()
      sessionStorage.removeItem('pending_ai_query')
      window.location.href = '/'
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Не удалось выйти из системы.')
      setIsLoggingOut(false)
    }
  }

  return (
    <>
      {isMenuOpen && (
        <div
          className="crm-user-menu"
          id="crm-user-menu"
          ref={menuRef}
          role="menu"
          style={menuPosition}
        >
          <button className="crm-user-menu__item" type="button" role="menuitem" onClick={openProfile}>
            Профиль
          </button>
          <button className="crm-user-menu__item" type="button" role="menuitem" onClick={openLogoutConfirm}>
            Выйти
          </button>
        </div>
      )}

      {isLogoutConfirmOpen && (
        <div className="crm-logout-modal__backdrop" role="presentation" onMouseDown={closeLogoutConfirm}>
          <section
            className="crm-logout-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-logout-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 className="crm-logout-modal__title" id="crm-logout-modal-title">
              Вы уверены, что хотите выйти из системы?
            </h2>

            {logoutError && (
              <p className="crm-logout-modal__error" role="alert">
                {logoutError}
              </p>
            )}

            <div className="crm-logout-modal__actions">
              <button
                className="crm-logout-modal__button crm-logout-modal__button--secondary"
                type="button"
                disabled={isLoggingOut}
                onClick={closeLogoutConfirm}
              >
                Отмена
              </button>
              <button
                className="crm-logout-modal__button crm-logout-modal__button--primary"
                type="button"
                disabled={isLoggingOut}
                onClick={() => void handleLogout()}
              >
                {isLoggingOut ? 'Выходим...' : 'Выйти'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
