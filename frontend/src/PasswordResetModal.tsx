import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import './PasswordResetModal.css'

type PasswordResetModalProps = {
  initialEmail?: string
  onClose: () => void
  onOpenLogin: (email?: string) => void
}

type PasswordResetStep = 'email' | 'code' | 'newPassword' | 'success'

const MOCK_RESET_EMAIL = 'dvhjkdsvbksdskj@mail.ru'
const MOCK_RESET_CODE = '3578'

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
  const [confirmationCode, setConfirmationCode] = useState(['', '', '', ''])
  const [isConfirmationCodeInvalid, setIsConfirmationCodeInvalid] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isNewPasswordVisible, setIsNewPasswordVisible] = useState(false)
  const [isRepeatPasswordVisible, setIsRepeatPasswordVisible] = useState(false)

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

  const handleBack = () => {
    if (resetStep === 'email') {
      if (emailError) {
        setEmailError('')
        return
      }

      onOpenLogin(email)
      return
    }

    if (resetStep === 'code') {
      setConfirmationCode(['', '', '', ''])
      setIsConfirmationCodeInvalid(false)
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

  const handleEmailSubmit = () => {
    const normalizedEmail = email.trim()

    if (!normalizedEmail) {
      setEmailError('Введите e-mail.')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setEmailError('Неверный e-mail')
      return
    }

    if (normalizedEmail !== MOCK_RESET_EMAIL) {
      setEmailError('Пользователь с таким e-mail не найден.')
      return
    }

    setEmail(normalizedEmail)
    setEmailError('')
    setConfirmationCode(['', '', '', ''])
    setIsConfirmationCodeInvalid(false)
    setResetStep('code')
  }

  const handleCodeChange = (index: number, value: string) => {
    const nextValue = value.replace(/\D/g, '').slice(-1)

    const nextCode = [...confirmationCode]
    nextCode[index] = nextValue

    setConfirmationCode(nextCode)

    const joinedCode = nextCode.join('')

    if (joinedCode.length === 4) {
      if (joinedCode === MOCK_RESET_CODE) {
        setIsConfirmationCodeInvalid(false)
        setResetStep('newPassword')
        return
      }

      setIsConfirmationCodeInvalid(true)
    } else {
      setIsConfirmationCodeInvalid(false)
    }

    if (nextValue && index < codeInputRefs.current.length - 1) {
      codeInputRefs.current[index + 1]?.focus()
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

  const handleResendCode = () => {
    setConfirmationCode(['', '', '', ''])
    setIsConfirmationCodeInvalid(false)
    codeInputRefs.current[0]?.focus()
  }

  const handlePasswordSubmit = () => {
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

    setPasswordError('')
    setResetStep('success')
  }

  const resetModalClassName = [
    'passwordResetModal',
    resetStep === 'email' ? 'passwordResetModalEmail' : '',
    resetStep === 'email' && emailError ? 'passwordResetModalEmailError' : '',
    resetStep === 'code' ? 'passwordResetModalCode' : '',
    resetStep === 'newPassword' ? 'passwordResetModalNewPassword' : '',
    resetStep === 'success' ? 'passwordResetModalSuccess' : '',
    isConfirmationCodeInvalid ? 'passwordResetModalCodeInvalid' : '',
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
                handleEmailSubmit()
              }}
            >
              <label className="passwordResetField">
                <span>E-mail</span>

                <input
                  type="email"
                  placeholder="Введите e-mail"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setEmailError('')
                  }}
                />
              </label>

              {emailError && <p className="passwordResetEmailErrorText">{emailError}</p>}

              <button className="passwordResetSubmitButton" type="submit">
                Отправить код
              </button>
            </form>
          </>
        )}

        {resetStep === 'code' && (
          <>
            {!isConfirmationCodeInvalid && (
              <div className="passwordResetTop">
                <button
                  className="passwordResetClose"
                  type="button"
                  aria-label="Закрыть"
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
              </div>

              <div
                className={
                  isConfirmationCodeInvalid
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
                      className={isConfirmationCodeInvalid ? 'isInvalid' : undefined}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={digit}
                      maxLength={1}
                      aria-label={`Цифра ${index + 1}`}
                      onChange={(event) => handleCodeChange(index, event.target.value)}
                      onKeyDown={(event) => handleCodeKeyDown(event, index)}
                    />
                  ))}
                </div>

                {isConfirmationCodeInvalid && (
                  <button
                    className="passwordResetCodeErrorMessage"
                    type="button"
                    onClick={handleResendCode}
                  >
                    Проверьте правильность ввода или отправьте новый код
                  </button>
                )}
              </div>

              <div className="passwordResetCodeLinks">
                <button className="passwordResetResendButton" type="button" disabled>
                  Отправить снова через 00:59
                </button>

                <button
                  className="passwordResetChangeEmailButton"
                  type="button"
                  onClick={() => {
                    setConfirmationCode(['', '', '', ''])
                    setIsConfirmationCodeInvalid(false)
                    setResetStep('email')
                  }}
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
                handlePasswordSubmit()
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
                    onClick={() => setIsRepeatPasswordVisible((value) => !value)}
                  >
                    {isRepeatPasswordVisible ? <EyeIcon /> : <EyeSlashIcon />}
                  </button>
                </div>
              </label>

              {passwordError && (
                <p className="passwordResetPasswordErrorText">{passwordError}</p>
              )}

              <button className="passwordResetSubmitButton" type="submit">
                Сохранить пароль
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