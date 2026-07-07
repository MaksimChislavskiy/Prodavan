import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import './LoginModal.css'

type LoginModalProps = {
  onClose: () => void
  onOpenRegister: () => void
  onOpenReset?: () => void
}

const MOCK_LOGIN_EMAIL = 'dvhjkdsvbksdskj@mail.ru'
const MOCK_LOGIN_PASSWORD = 'vsdfjksfksdks'

function LoginModal({ onClose, onOpenRegister, onOpenReset }: LoginModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [loginError, setLoginError] = useState('')

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const timeoutId = window.setTimeout(() => {
      const firstInput = modalRef.current?.querySelector<HTMLInputElement>('input')
      firstInput?.focus()
    }, 0)

    return () => {
      document.body.style.overflow = originalOverflow
      window.clearTimeout(timeoutId)
    }
  }, [])

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onClose()
    }
  }

  const handleLoginSubmit = () => {
    const normalizedEmail = email.trim()

    if (
      normalizedEmail === MOCK_LOGIN_EMAIL &&
      password === MOCK_LOGIN_PASSWORD
    ) {
      setLoginError('')
      window.location.href = '/app'
      return
    }

    setLoginError('Неверный e-mail или пароль')
  }

  return (
    <div
      className="loginModalOverlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
      onKeyDown={handleKeyDown}
    >
      <div
        className={loginError ? 'loginModal loginModalWithError' : 'loginModal'}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
      >
        {!loginError && (
          <div className="loginModalTop">
            <button
              className="loginModalClose"
              type="button"
              aria-label="Закрыть"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
        )}

        {loginError && (
          <div className="loginModalBackRow">
            <button
              className="loginBackButton"
              type="button"
              aria-label="Назад"
              onClick={() => setLoginError('')}
            >
              <ArrowLeftIcon />
            </button>
          </div>
        )}

        <div className="loginModalTitleBlock">
          <h2 id="login-modal-title">Вход</h2>
        </div>

        <form
          className="loginModalForm"
          onSubmit={(event) => {
            event.preventDefault()
            handleLoginSubmit()
          }}
        >
          <label className="loginField">
            <span>E-mail</span>
            <input
              type="email"
              placeholder="Введите e-mail"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setLoginError('')
              }}
            />
          </label>

          <div className="loginPasswordBlock">
            <label className="loginField loginPasswordField">
              <span>Пароль</span>

              <div className="loginPasswordInput">
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  placeholder="Введите пароль"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setLoginError('')
                  }}
                />

                <button
                  className="loginPasswordToggle"
                  type="button"
                  aria-label={isPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                  onClick={() => setIsPasswordVisible((value) => !value)}
                >
                  {isPasswordVisible ? <EyeIcon /> : <EyeSlashIcon />}
                </button>
              </div>
            </label>

            <button
              className="loginForgotButton"
              type="button"
              onClick={onOpenReset}
            >
              Забыли пароль?
            </button>
          </div>

          {loginError && <p className="loginErrorMessage">{loginError}</p>}

          <div className="loginActionsBlock">
            <button className="loginSubmitButton" type="submit">
              Войти
            </button>

            <div className="loginRegisterLink">
              <span>Нет аккаунта?</span>

              <button type="button" onClick={onOpenRegister}>
                Зарегистрироваться
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6.4 5.2 12 10.8l5.6-5.6 1.2 1.2-5.6 5.6 5.6 5.6-1.2 1.2L12 13.2l-5.6 5.6-1.2-1.2 5.6-5.6-5.6-5.6 1.2-1.2Z"
        fill="currentColor"
      />
    </svg>
  )
}

function ArrowLeftIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <path
        d="M18.2 9.5 8.4 19.3a1 1 0 0 0 0 1.4l9.8 9.8 1.9-1.9-7.5-7.5h19.5v-2.7H12.6l7.5-7.5-1.9-1.4Z"
        fill="currentColor"
      />
    </svg>
  )
}

function EyeSlashIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.3 4.6 4.6 3.3l16.1 16.1-1.3 1.3-3-3A11.9 11.9 0 0 1 12 18.6C6.7 18.6 3.1 14.8 1.6 12c.8-1.5 2.2-3.2 4.1-4.5L3.3 4.6Zm4 4c-1.5.9-2.7 2.1-3.5 3.4 1.3 2 4.2 4.6 8.2 4.6.9 0 1.8-.1 2.6-.4l-1.8-1.8a3 3 0 0 1-3.2-3.2L7.3 8.6ZM12 5.4c5.3 0 8.9 3.8 10.4 6.6-.6 1.1-1.5 2.3-2.7 3.3l-1.4-1.4c.8-.6 1.4-1.3 1.9-1.9-1.3-2-4.2-4.6-8.2-4.6-.5 0-1 .1-1.5.1L8.9 5.9c1-.3 2-.5 3.1-.5Zm-.3 3.6h.3a3 3 0 0 1 3 3v.3L11.7 9Z"
        fill="currentColor"
      />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5.4c5.3 0 8.9 3.8 10.4 6.6-1.5 2.8-5.1 6.6-10.4 6.6S3.1 14.8 1.6 12C3.1 9.2 6.7 5.4 12 5.4Zm0 2C8 7.4 5.1 10 3.8 12c1.3 2 4.2 4.6 8.2 4.6s6.9-2.6 8.2-4.6C18.9 10 16 7.4 12 7.4Zm0 1.6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
        fill="currentColor"
      />
    </svg>
  )
}

export default LoginModal