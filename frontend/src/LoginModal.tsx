import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ApiError, apiRequest } from './shared/api/apiClient'
import { resendRegistrationCode } from './shared/api/authApi'
import { setAccessToken } from './shared/api/authToken'
import './LoginModal.css'

type LoginModalProps = {
  initialEmail?: string
  onClose: () => void
  onOpenRegister: () => void
  onOpenReset?: (email?: string) => void
}

type LoginResponse = {
  access_token: string
  user: {
    id: string
    name: string
    surname: string
    email: string
    role: string
  }
}

type LoginFieldErrors = {
  email?: string
  password?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
let savedLoginDraft = { email: '', password: '' }

function LoginModal({ initialEmail = '', onClose, onOpenRegister, onOpenReset }: LoginModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const confirmRef = useRef<HTMLDivElement | null>(null)

  const [email, setEmail] = useState(initialEmail || savedLoginDraft.email)
  const [password, setPassword] = useState(savedLoginDraft.password)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({})
  const [loginError, setLoginError] = useState('')
  const [isUnconfirmedEmail, setIsUnconfirmedEmail] = useState(false)
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)

  const normalizedEmail = email.trim().toLowerCase()
  const isEmailValid = Boolean(normalizedEmail && EMAIL_PATTERN.test(normalizedEmail))
  const isPasswordValid = password.length >= 8 && password.length <= 255
  const isFormValid = isEmailValid && isPasswordValid
  const isDirty = Boolean(email || password)

  useEffect(() => {
    savedLoginDraft = { email, password }
  }, [email, password])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const controller = new AbortController()
    void fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return
      const data = await response.json().catch(() => null) as { access_token?: unknown } | null
      if (typeof data?.access_token === 'string') {
        setAccessToken(data.access_token)
        window.location.replace('/app')
      }
    }).catch(() => undefined)

    const timeoutId = window.setTimeout(() => {
      modalRef.current?.querySelector<HTMLInputElement>('input[type="email"]')?.focus()
    }, 0)

    return () => {
      controller.abort()
      document.body.style.overflow = originalOverflow
      window.clearTimeout(timeoutId)
    }
  }, [])

  const requestClose = () => {
    if (isDirty) {
      setIsCloseConfirmOpen(true)
      return
    }
    onClose()
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isCloseConfirmOpen) requestClose()
  }

  const getFocusableElements = (container: HTMLElement | null) => {
    if (!container) return []
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), a[href]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (isCloseConfirmOpen) setIsCloseConfirmOpen(false)
      else requestClose()
      return
    }

    if (event.key !== 'Tab') return
    const container = isCloseConfirmOpen ? confirmRef.current : modalRef.current
    const focusable = getFocusableElements(container)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const validateFields = () => {
    const errors: LoginFieldErrors = {}
    if (!normalizedEmail) errors.email = 'Заполните поле.'
    else if (!EMAIL_PATTERN.test(normalizedEmail)) errors.email = 'Укажите корректный e-mail.'
    if (!password) errors.password = 'Заполните поле.'
    else if (password.length < 8 || password.length > 255) errors.password = 'Пароль должен содержать не менее 8 символов.'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleLoginSubmit = async () => {
    if (isSubmitting || !isFormValid || !validateFields()) return

    try {
      setIsSubmitting(true)
      setLoginError('')
      setIsUnconfirmedEmail(false)

      const data = await apiRequest<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: { email: normalizedEmail, password },
        timeoutMs: 10_000,
      })

      savedLoginDraft = { email: '', password: '' }
      setAccessToken(data.access_token)
      window.location.href = '/app'
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось выполнить вход'
      setLoginError(message)
      setIsUnconfirmedEmail(error instanceof ApiError && error.status === 403)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResendConfirmation = async () => {
    if (!normalizedEmail || isResendingConfirmation) return
    try {
      setIsResendingConfirmation(true)
      await resendRegistrationCode(normalizedEmail)
      setLoginError('Письмо подтверждения отправлено повторно.')
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Не удалось отправить письмо подтверждения повторно.')
    } finally {
      setIsResendingConfirmation(false)
    }
  }

  const clearAuthError = () => {
    setLoginError('')
    setIsUnconfirmedEmail(false)
  }

  return (
    <div className="loginModalOverlay" role="presentation" onMouseDown={handleOverlayMouseDown} onKeyDown={handleKeyDown}>
      <div className="loginModal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="login-modal-title">
        <div className="loginModalTop">
          <button className="loginModalClose" tabIndex={7} type="button" aria-label="Закрыть" onClick={requestClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="loginModalTitleBlock"><h2 id="login-modal-title">Вход</h2></div>

        <form className="loginModalForm" noValidate onSubmit={(event) => { event.preventDefault(); void handleLoginSubmit() }}>
          <label className="loginField">
            <span>E-mail</span>
            <input tabIndex={1} type="email" placeholder="Введите e-mail" value={email} maxLength={255} disabled={isSubmitting}
              onBlur={() => { if (email && !isEmailValid) setFieldErrors((current) => ({ ...current, email: 'Укажите корректный e-mail.' })) }}
              onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: undefined })); clearAuthError() }} />
            {fieldErrors.email && <small className="loginFieldError" role="alert">{fieldErrors.email}</small>}
          </label>

          <div className="loginPasswordBlock">
            <label className="loginField loginPasswordField">
              <span>Пароль</span>
              <div className="loginPasswordInput">
                <input tabIndex={2} type={isPasswordVisible ? 'text' : 'password'} placeholder="Введите пароль" value={password} maxLength={255} disabled={isSubmitting}
                  onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: undefined })); clearAuthError() }} />
                <button className="loginPasswordToggle" tabIndex={3} type="button" aria-label={isPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'} disabled={isSubmitting}
                  onClick={() => setIsPasswordVisible((value) => !value)}>
                  {isPasswordVisible ? <EyeIcon /> : <EyeSlashIcon />}
                </button>
              </div>
              {fieldErrors.password && <small className="loginFieldError" role="alert">{fieldErrors.password}</small>}
            </label>

            <button className="loginForgotButton" tabIndex={4} type="button" disabled={isSubmitting} onClick={() => onOpenReset?.(email)}>
              Забыли пароль?
            </button>
          </div>

          {loginError && (
            <div className={isUnconfirmedEmail ? 'loginErrorBlock' : 'loginErrorBlock loginErrorBlockCompact'} role="alert">
              <p className="loginErrorMessage">{loginError}</p>
              {isUnconfirmedEmail && (
                <button type="button" className="loginResendConfirmation" disabled={isResendingConfirmation} onClick={() => void handleResendConfirmation()}>
                  {isResendingConfirmation ? 'Отправляем...' : 'Отправить письмо повторно'}
                </button>
              )}
            </div>
          )}

          <div className="loginActionsBlock">
            <button className="loginSubmitButton" tabIndex={5} type="submit" disabled={!isFormValid || isSubmitting}>
              {isSubmitting ? <><span className="loginButtonSpinner" aria-hidden="true" />Выполняется вход...</> : 'Войти'}
            </button>
            <div className="loginRegisterLink">
              <span>Нет аккаунта?</span>
              <button tabIndex={6} type="button" disabled={isSubmitting} onClick={onOpenRegister}>Зарегистрироваться</button>
            </div>
          </div>
        </form>
      </div>

      {isCloseConfirmOpen && (
        <div className="loginCloseConfirmOverlay" role="presentation">
          <div ref={confirmRef} className="loginCloseConfirm" role="alertdialog" aria-modal="true" aria-labelledby="login-close-confirm-title">
            <h3 id="login-close-confirm-title">Введённые данные будут потеряны. Закрыть окно?</h3>
            <div className="loginCloseConfirmActions">
              <button type="button" onClick={() => { savedLoginDraft = { email: '', password: '' }; onClose() }}>Закрыть</button>
              <button type="button" autoFocus onClick={() => setIsCloseConfirmOpen(false)}>Остаться</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CloseIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5.2 12 10.8l5.6-5.6 1.2 1.2-5.6 5.6 5.6 5.6-1.2 1.2L12 13.2l-5.6 5.6-1.2-1.2 5.6-5.6-5.6-5.6 1.2-1.2Z" fill="currentColor" /></svg>
}

function EyeSlashIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.3 4.6 4.6 3.3l16.1 16.1-1.3 1.3-3-3A11.9 11.9 0 0 1 12 18.6C6.7 18.6 3.1 14.8 1.6 12c.8-1.5 2.2-3.2 4.1-4.5L3.3 4.6Zm4 4c-1.5.9-2.7 2.1-3.5 3.4 1.3 2 4.2 4.6 8.2 4.6.9 0 1.8-.1 2.6-.4l-1.8-1.8a3 3 0 0 1-3.2-3.2L7.3 8.6ZM12 5.4c5.3 0 8.9 3.8 10.4 6.6-.6 1.1-1.5 2.3-2.7 3.3l-1.4-1.4c.8-.6 1.4-1.3 1.9-1.9-1.3-2-4.2-4.6-8.2-4.6-.5 0-1 .1-1.5.1L8.9 5.9c1-.3 2-.5 3.1-.5Zm-.3 3.6h.3a3 3 0 0 1 3 3v.3L11.7 9Z" fill="currentColor" /></svg>
}

function EyeIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.4c5.3 0 8.9 3.8 10.4 6.6-1.5 2.8-5.1 6.6-10.4 6.6S3.1 14.8 1.6 12C3.1 9.2 6.7 5.4 12 5.4Zm0 2C8 7.4 5.1 10 3.8 12c1.3 2 4.2 4.6 8.2 4.6s6.9-2.6 8.2-4.6C18.9 10 16 7.4 12 7.4Zm0 1.6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" fill="currentColor" /></svg>
}

export default LoginModal