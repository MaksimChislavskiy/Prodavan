import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { apiRequest } from './shared/api/apiClient'
import './PasswordResetModal.css'

type PasswordResetModalProps = {
  initialEmail?: string
  onClose: () => void
  onOpenLogin: (email?: string) => void
}

type PasswordResetStep = 'email' | 'code' | 'newPassword' | 'success'

type PasswordResetResponse = {
  message: string
}

const RESEND_DELAY_SECONDS = 60
const CODE_LIFETIME_SECONDS = 10 * 60
const SUCCESS_REDIRECT_DELAY_MS = 1500

function createEmptyCode() {
  return ['', '', '', '']
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError) {
    return 'Проверьте подключение к интернету.'
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

function PasswordResetModal({
  initialEmail = '',
  onClose,
  onOpenLogin,
}: PasswordResetModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([])

  const [resetStep, setResetStep] = useState<PasswordResetStep>('email')
  const [email, setEmail] = useState(initialEmail)
  const [emailError, setEmailError] = useState('')
  const [confirmationCode, setConfirmationCode] = useState(createEmptyCode)
  const [codeError, setCodeError] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isNewPasswordVisible, setIsNewPasswordVisible] = useState(false)
  const [isRepeatPasswordVisible, setIsRepeatPasswordVisible] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isConfirmingCode, setIsConfirmingCode] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [codeExpiresSeconds, setCodeExpiresSeconds] = useState(0)

  const isBusy = isSendingCode || isConfirmingCode || isSavingPassword
  const isCodeEntryBlocked =
    codeExpiresSeconds === 0 || codeError.includes('Превышено количество попыток')
  const displayedCodeError =
    codeError ||
    (resetStep === 'code' && codeExpiresSeconds === 0
      ? 'Срок действия кода истёк. Запросите новый код.'
      : '')

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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const firstInput = modalRef.current?.querySelector<HTMLInputElement>('input')
      firstInput?.focus()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [resetStep])

  useEffect(() => {
    if (resetStep !== 'code') {
      return
    }

    const intervalId = window.setInterval(() => {
      setResendSeconds((currentSeconds) => Math.max(0, currentSeconds - 1))
      setCodeExpiresSeconds((currentSeconds) => Math.max(0, currentSeconds - 1))
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [resetStep])

  useEffect(() => {
    if (resetStep !== 'success') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      onOpenLogin(email)
    }, SUCCESS_REDIRECT_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [email, onOpenLogin, resetStep])

  const startCodeTimers = () => {
    setResendSeconds(RESEND_DELAY_SECONDS)
    setCodeExpiresSeconds(CODE_LIFETIME_SECONDS)
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!isBusy && event.target === event.currentTarget) {
      onClose()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isBusy && event.key === 'Escape') {
      onClose()
    }
  }

  const handleBack = () => {
    if (isBusy) {
      return
    }

    if (resetStep === 'email') {
      if (emailError) {
        setEmailError('')
        return
      }

      onOpenLogin(email)
      return
    }

    if (resetStep === 'code') {
      setConfirmationCode(createEmptyCode())
      setCodeError('')
      setResendSeconds(0)
      setCodeExpiresSeconds(0)
      setResetStep('email')
      return
    }

    if (resetStep === 'newPassword') {
      setPasswordError('')
      setNewPassword('')
      setRepeatPassword('')
      setResetStep('code')
    }
  }

  const handleEmailSubmit = async () => {
    const normalizedEmail = email.trim()

    if (!normalizedEmail) {
      setEmailError('Введите e-mail.')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setEmailError('Неверный e-mail.')
      return
    }

    try {
      setIsSendingCode(true)
      setEmailError('')

      await apiRequest<PasswordResetResponse>('/api/auth/forgot-password', {
        method: 'POST',
        body: {
          email: normalizedEmail,
        },
      })

      setEmail(normalizedEmail)
      setConfirmationCode(createEmptyCode())
      setCodeError('')
      startCodeTimers()
      setResetStep('code')
    } catch (error) {
      setEmailError(
        getRequestErrorMessage(
          error,
          'Не удалось отправить код. Проверьте e-mail и попробуйте позже.',
        ),
      )
    } finally {
      setIsSendingCode(false)
    }
  }

  async function handleCodeSubmit(code: string) {
    if (isConfirmingCode) {
      return
    }

    if (codeExpiresSeconds === 0) {
      setCodeError('Срок действия кода истёк. Запросите новый код.')
      return
    }

    try {
      setIsConfirmingCode(true)
      setCodeError('')

      await apiRequest<PasswordResetResponse>('/api/auth/reset-password/confirm', {
        method: 'POST',
        body: {
          email,
          code,
        },
      })

      setResetStep('newPassword')
    } catch (error) {
      setCodeError(
        getRequestErrorMessage(
          error,
          'Проверьте правильность ввода или отправьте новый код.',
        ),
      )
    } finally {
      setIsConfirmingCode(false)
    }
  }

  const handleCodeChange = (index: number, value: string) => {
    if (isConfirmingCode || isCodeEntryBlocked) {
      return
    }

    const nextValue = value.replace(/\D/g, '').slice(-1)
    const nextCode = [...confirmationCode]
    nextCode[index] = nextValue

    setConfirmationCode(nextCode)
    setCodeError('')

    if (nextValue && index < codeInputRefs.current.length - 1) {
      codeInputRefs.current[index + 1]?.focus()
    }

    const joinedCode = nextCode.join('')

    if (joinedCode.length === 4) {
      void handleCodeSubmit(joinedCode)
    }
  }

  const handleCodeKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    index: number,
  ) => {
    if (event.key === 'Backspace' && !confirmationCode[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus()
    }
  }

  const handleResendCode = async () => {
    if (resendSeconds > 0 || isSendingCode) {
      return
    }

    try {
      setIsSendingCode(true)
      setCodeError('')

      await apiRequest<PasswordResetResponse>('/api/auth/forgot-password', {
        method: 'POST',
        body: {
          email,
        },
      })

      setConfirmationCode(createEmptyCode())
      startCodeTimers()

      window.setTimeout(() => {
        codeInputRefs.current[0]?.focus()
      }, 0)
    } catch (error) {
      setCodeError(
        getRequestErrorMessage(
          error,
          'Не удалось отправить код. Проверьте e-mail и попробуйте позже.',
        ),
      )
    } finally {
      setIsSendingCode(false)
    }
  }

  const handleChangeEmail = () => {
    if (isBusy) {
      return
    }

    setConfirmationCode(createEmptyCode())
    setCodeError('')
    setResendSeconds(0)
    setCodeExpiresSeconds(0)
    setResetStep('email')
  }

  const handlePasswordSubmit = async () => {
    if (!newPassword || !repeatPassword) {
      setPasswordError('Заполните поле.')
      return
    }

    const hasEnoughLength = newPassword.length >= 8
    const hasDigitOrSymbol = /[0-9!@#$%^&*()_+\-.,]/.test(newPassword)

    if (!hasEnoughLength || !hasDigitOrSymbol) {
      setPasswordError('Пароль не соответствует требованиям безопасности.')
      return
    }

    if (newPassword !== repeatPassword) {
      setPasswordError('Пароли не совпадают.')
      return
    }

    try {
      setIsSavingPassword(true)
      setPasswordError('')

      await apiRequest<PasswordResetResponse>('/api/auth/reset-password', {
        method: 'POST',
        body: {
          email,
          new_password: newPassword,
        },
      })

      setResetStep('success')
    } catch (error) {
      setPasswordError(
        getRequestErrorMessage(error, 'Не удалось изменить пароль. Попробуйте позже.'),
      )
    } finally {
      setIsSavingPassword(false)
    }
  }

  const hasCodeError = Boolean(displayedCodeError)
  const resetModalClassName = [
    'passwordResetModal',
    resetStep === 'email' ? 'passwordResetModalEmail' : '',
    resetStep === 'email' && emailError ? 'passwordResetModalEmailError' : '',
    resetStep === 'code' ? 'passwordResetModalCode' : '',
    resetStep === 'newPassword' ? 'passwordResetModalNewPassword' : '',
    resetStep === 'success' ? 'passwordResetModalSuccess' : '',
    hasCodeError ? 'passwordResetModalCodeInvalid' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className="passwordResetOverlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
      onKeyDown={handleKeyDown}
    >
      <div
        className={resetModalClassName}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-reset-modal-title"
      >
        {resetStep === 'email' && (
          <>
            {!emailError && (
              <div className="passwordResetTop">
                <button
                  className="passwordResetClose"
                  type="button"
                  aria-label="Закрыть"
                  disabled={isSendingCode}
                  onClick={onClose}
                >
                  <CloseIcon />
                </button>
              </div>
            )}

            {emailError && (
              <div className="passwordResetHeaderRow">
                <button
                  className="passwordResetBackButton"
                  type="button"
                  aria-label="Назад"
                  disabled={isSendingCode}
                  onClick={handleBack}
                >
                  <ArrowLeftIcon />
                </button>

                <div className="passwordResetHeaderTitleWrap">
                  <h2 id="password-reset-modal-title">Восстановление доступа</h2>
                </div>
              </div>
            )}

            {!emailError && (
              <div className="passwordResetTitleBlock">
                <h2 id="password-reset-modal-title">Восстановление доступа</h2>
              </div>
            )}

            <div className="passwordResetStepBlock">
              <p>Шаг 1 из 3</p>
            </div>

            <form
              className="passwordResetEmailForm"
              onSubmit={(event) => {
                event.preventDefault()
                void handleEmailSubmit()
              }}
            >
              <label className="passwordResetField">
                <span>E-mail</span>

                <input
                  type="email"
                  placeholder="Введите e-mail"
                  value={email}
                  disabled={isSendingCode}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setEmailError('')
                  }}
                />
              </label>

              {emailError && <p className="passwordResetEmailErrorText">{emailError}</p>}

              <button
                className="passwordResetSubmitButton"
                type="submit"
                disabled={isSendingCode}
              >
                {isSendingCode ? 'Отправляем код...' : 'Отправить код'}
              </button>
            </form>
          </>
        )}

        {resetStep === 'code' && (
          <>
            {!hasCodeError && (
              <div className="passwordResetTop">
                <button
                  className="passwordResetClose"
                  type="button"
                  aria-label="Закрыть"
                  disabled={isBusy}
                  onClick={onClose}
                >
                  <CloseIcon />
                </button>
              </div>
            )}

            <div className="passwordResetHeaderRow">
              <button
                className="passwordResetBackButton"
                type="button"
                aria-label="Назад"
                disabled={isBusy}
                onClick={handleBack}
              >
                <ArrowLeftIcon />
              </button>

              <div className="passwordResetHeaderTitleWrap">
                <h2 id="password-reset-modal-title">Восстановление доступа</h2>
              </div>
            </div>

            <div className="passwordResetStepBlock">
              <p>Шаг 2 из 3</p>
            </div>

            <div className="passwordResetCodeContent">
              <div className="passwordResetCodeIntro">
                <h3>Подтвердите ваш E-mail</h3>
                <p>Введите код, отправленный на почту {email}</p>
                <p>
                  {codeExpiresSeconds > 0
                    ? `Код действителен ещё ${formatCountdown(codeExpiresSeconds)}.`
                    : 'Срок действия кода истёк.'}
                </p>
              </div>

              <div
                className={
                  hasCodeError
                    ? 'passwordResetCodeArea passwordResetCodeAreaInvalid'
                    : 'passwordResetCodeArea'
                }
              >
                <div className="passwordResetCodeInputs" aria-label="Код подтверждения">
                  {confirmationCode.map((digit, index) => (
                    <input
                      key={`password-reset-code-${index}`}
                      ref={(element) => {
                        codeInputRefs.current[index] = element
                      }}
                      className={hasCodeError ? 'isInvalid' : undefined}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={digit}
                      maxLength={1}
                      aria-label={`Цифра ${index + 1}`}
                      disabled={isBusy || isCodeEntryBlocked}
                      onChange={(event) => handleCodeChange(index, event.target.value)}
                      onKeyDown={(event) => handleCodeKeyDown(event, index)}
                    />
                  ))}
                </div>

                {hasCodeError && (
                  <button
                    className="passwordResetCodeErrorMessage"
                    type="button"
                    disabled={resendSeconds > 0 || isSendingCode}
                    onClick={() => void handleResendCode()}
                  >
                    {displayedCodeError}
                  </button>
                )}
              </div>

              <div className="passwordResetCodeLinks">
                <button
                  className={`passwordResetResendButton ${
                    resendSeconds === 0 ? 'passwordResetChangeEmailButton' : ''
                  }`}
                  type="button"
                  disabled={resendSeconds > 0 || isSendingCode}
                  onClick={() => void handleResendCode()}
                >
                  {isSendingCode
                    ? 'Отправляем код...'
                    : resendSeconds > 0
                      ? `Отправить снова через ${formatCountdown(resendSeconds)}`
                      : 'Отправить код повторно'}
                </button>

                <button
                  className="passwordResetChangeEmailButton"
                  type="button"
                  disabled={isBusy}
                  onClick={handleChangeEmail}
                >
                  Ввести другой адрес
                </button>
              </div>
            </div>
          </>
        )}

        {resetStep === 'newPassword' && (
          <>
            <div className="passwordResetTop">
              <button
                className="passwordResetClose"
                type="button"
                aria-label="Закрыть"
                disabled={isSavingPassword}
                onClick={onClose}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="passwordResetHeaderRow">
              <button
                className="passwordResetBackButton"
                type="button"
                aria-label="Назад"
                disabled={isSavingPassword}
                onClick={handleBack}
              >
                <ArrowLeftIcon />
              </button>

              <div className="passwordResetHeaderTitleWrap">
                <h2 id="password-reset-modal-title">Восстановление доступа</h2>
              </div>
            </div>

            <div className="passwordResetStepBlock">
              <p>Шаг 3 из 3</p>
            </div>

            <form
              className="passwordResetPasswordForm"
              onSubmit={(event) => {
                event.preventDefault()
                void handlePasswordSubmit()
              }}
            >
              <div className="passwordResetPasswordBlock">
                <label className="passwordResetField passwordResetPasswordField">
                  <span>Новый пароль</span>

                  <div className="passwordResetPasswordInput">
                    <input
                      type={isNewPasswordVisible ? 'text' : 'password'}
                      placeholder="Введите новый пароль"
                      value={newPassword}
                      disabled={isSavingPassword}
                      onChange={(event) => {
                        setNewPassword(event.target.value)
                        setPasswordError('')
                      }}
                    />

                    <button
                      className="passwordResetPasswordToggle"
                      type="button"
                      aria-label={
                        isNewPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'
                      }
                      disabled={isSavingPassword}
                      onClick={() => setIsNewPasswordVisible((value) => !value)}
                    >
                      {isNewPasswordVisible ? <EyeIcon /> : <EyeSlashIcon />}
                    </button>
                  </div>
                </label>

                <div className="passwordResetPasswordRules">
                  <p>Минимум 8 символов</p>
                  <p>Содержит цифру или символ</p>
                </div>
              </div>

              <label className="passwordResetField passwordResetPasswordField">
                <span>Повтор пароля</span>

                <div className="passwordResetPasswordInput">
                  <input
                    type={isRepeatPasswordVisible ? 'text' : 'password'}
                    placeholder="Повторите пароль"
                    value={repeatPassword}
                    disabled={isSavingPassword}
                    onChange={(event) => {
                      setRepeatPassword(event.target.value)
                      setPasswordError('')
                    }}
                  />

                  <button
                    className="passwordResetPasswordToggle"
                    type="button"
                    aria-label={
                      isRepeatPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'
                    }
                    disabled={isSavingPassword}
                    onClick={() => setIsRepeatPasswordVisible((value) => !value)}
                  >
                    {isRepeatPasswordVisible ? <EyeIcon /> : <EyeSlashIcon />}
                  </button>
                </div>
              </label>

              {passwordError && (
                <p className="passwordResetPasswordErrorText">{passwordError}</p>
              )}

              <button
                className="passwordResetSubmitButton"
                type="submit"
                disabled={isSavingPassword}
              >
                {isSavingPassword ? 'Сохраняем пароль...' : 'Сохранить пароль'}
              </button>
            </form>
          </>
        )}

        {resetStep === 'success' && (
          <>
            <div className="passwordResetSuccessHeader">
              <h2 id="password-reset-modal-title">Пароль успешно восстановлен</h2>
            </div>

            <div className="passwordResetSuccessStepBlock">
              <p>Шаг 3 из 3</p>
            </div>

            <div className="passwordResetSuccessContent">
              <button
                className="passwordResetSuccessLoginButton"
                type="button"
                onClick={() => onOpenLogin(email)}
              >
                Войти
              </button>
            </div>
          </>
        )}
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

export default PasswordResetModal
