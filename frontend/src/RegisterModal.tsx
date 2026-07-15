import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  confirmRegistration,
  startRegistration,
  type RegisterRequest,
} from './shared/api/authApi'
import { setAccessToken } from './shared/api/authToken'
import './RegisterModal.css'

type RegisterModalProps = {
  onClose: () => void
  onOpenLogin?: () => void
}

type RegisterStep = 'form' | 'emailConfirm' | 'success'

const PERSON_NAME_PATTERN = /^[A-Za-zА-Яа-яЁё -]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_HAS_DIGIT_OR_SPECIAL_PATTERN = /[0-9]|[^A-Za-zА-Яа-яЁё]/
const RESEND_TIMEOUT_SECONDS = 59

function RegisterModal({ onClose, onOpenLogin }: RegisterModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const isConfirmingRef = useRef(false)

  const [registerStep, setRegisterStep] = useState<RegisterStep>('form')
  const [name, setName] = useState('')
  const [surname, setSurname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [confirmationCode, setConfirmationCode] = useState(['', '', '', ''])
  const [formError, setFormError] = useState('')
  const [confirmationError, setConfirmationError] = useState('')
  const [resendSeconds, setResendSeconds] = useState(RESEND_TIMEOUT_SECONDS)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isRepeatPasswordVisible, setIsRepeatPasswordVisible] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isResending, setIsResending] = useState(false)

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
  }, [registerStep])

  useEffect(() => {
    if (registerStep !== 'emailConfirm' || resendSeconds <= 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [registerStep, resendSeconds])

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

  const getRegistrationData = (): RegisterRequest => ({
    name: name.trim(),
    surname: surname.trim(),
    email: email.trim().toLowerCase(),
    password,
  })

  const getFormValidationError = () => {
    const registrationData = getRegistrationData()

    if (registrationData.name.length < 2 || registrationData.name.length > 50) {
      return 'Имя должно содержать от 2 до 50 символов'
    }

    if (!PERSON_NAME_PATTERN.test(registrationData.name)) {
      return 'В имени допустимы только буквы, пробел и дефис'
    }

    if (registrationData.surname.length < 2 || registrationData.surname.length > 50) {
      return 'Фамилия должна содержать от 2 до 50 символов'
    }

    if (!PERSON_NAME_PATTERN.test(registrationData.surname)) {
      return 'В фамилии допустимы только буквы, пробел и дефис'
    }

    if (!EMAIL_PATTERN.test(registrationData.email)) {
      return 'Введите корректный e-mail'
    }

    if (password.length < 8 || password.length > 128) {
      return 'Пароль должен содержать от 8 до 128 символов'
    }

    if (!PASSWORD_HAS_DIGIT_OR_SPECIAL_PATTERN.test(password)) {
      return 'Пароль должен содержать цифру или специальный символ'
    }

    if (password !== repeatPassword) {
      return 'Пароли не совпадают'
    }

    return ''
  }

  const handleRegisterSubmit = async () => {
    const validationError = getFormValidationError()

    if (validationError) {
      setFormError(validationError)
      return
    }

    const registrationData = getRegistrationData()

    try {
      setIsRegistering(true)
      setFormError('')

      await startRegistration(registrationData)

      setEmail(registrationData.email)
      setConfirmationCode(['', '', '', ''])
      setConfirmationError('')
      setResendSeconds(RESEND_TIMEOUT_SECONDS)
      setRegisterStep('emailConfirm')
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Не удалось отправить код подтверждения',
      )
    } finally {
      setIsRegistering(false)
    }
  }

  const handleBackToForm = () => {
    setConfirmationCode(['', '', '', ''])
    setConfirmationError('')
    setRegisterStep('form')
  }

  const handleConfirmCode = async (code: string) => {
    if (code.length !== 4 || isConfirmingRef.current) {
      return
    }

    try {
      isConfirmingRef.current = true
      setIsConfirming(true)
      setConfirmationError('')

      const data = await confirmRegistration({
        email: email.trim().toLowerCase(),
        code,
      })

      setAccessToken(data.access_token)
      setRegisterStep('success')
    } catch (error) {
      setConfirmationError(
        error instanceof Error ? error.message : 'Не удалось подтвердить код',
      )
    } finally {
      isConfirmingRef.current = false
      setIsConfirming(false)
    }
  }

  const handleCodeChange = (index: number, value: string) => {
    const nextValue = value.replace(/\D/g, '').slice(-1)
    const nextCode = [...confirmationCode]
    nextCode[index] = nextValue

    setConfirmationCode(nextCode)
    setConfirmationError('')

    const joinedCode = nextCode.join('')

    if (nextValue && index < codeInputRefs.current.length - 1) {
      codeInputRefs.current[index + 1]?.focus()
    }

    if (joinedCode.length === 4) {
      void handleConfirmCode(joinedCode)
    }
  }

  const handleCodePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pastedCode = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)

    if (!pastedCode) {
      return
    }

    event.preventDefault()

    const nextCode = ['', '', '', '']

    pastedCode.split('').forEach((digit, index) => {
      nextCode[index] = digit
    })

    setConfirmationCode(nextCode)
    setConfirmationError('')

    if (pastedCode.length === 4) {
      void handleConfirmCode(pastedCode)
      return
    }

    codeInputRefs.current[pastedCode.length]?.focus()
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
    if (resendSeconds > 0 || isResending || isConfirming) {
      return
    }

    try {
      setIsResending(true)
      setConfirmationError('')

      await startRegistration(getRegistrationData())

      setConfirmationCode(['', '', '', ''])
      setResendSeconds(RESEND_TIMEOUT_SECONDS)
      window.setTimeout(() => codeInputRefs.current[0]?.focus(), 0)
    } catch (error) {
      setConfirmationError(
        error instanceof Error ? error.message : 'Не удалось отправить новый код',
      )
    } finally {
      setIsResending(false)
    }
  }

  const isConfirmationCodeInvalid = Boolean(confirmationError)
  const displayEmail = email.trim().toLowerCase()
  const resendTimer = `00:${String(resendSeconds).padStart(2, '0')}`

  const registerModalClassName = [
    'registerModal',
    registerStep === 'emailConfirm' ? 'registerModalEmailConfirm' : '',
    registerStep === 'success' ? 'registerModalSuccess' : '',
    isConfirmationCodeInvalid ? 'registerModalEmailConfirmInvalid' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className="registerModalOverlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
      onKeyDown={handleKeyDown}
    >
      <div
        className={registerModalClassName}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-modal-title"
      >
        {registerStep === 'form' && (
          <>
            <div className="registerModalTop">
              <button
                className="registerModalClose"
                type="button"
                aria-label="Закрыть"
                onClick={onClose}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="registerModalTitleBlock">
              <h2 id="register-modal-title">Регистрация</h2>
            </div>

            <div className="registerModalStepBlock">
              <p>Шаг 1 из 2</p>
            </div>

            <form
              className="registerModalForm"
              onSubmit={(event) => {
                event.preventDefault()
                void handleRegisterSubmit()
              }}
            >
              <label className="registerField">
                <span>Имя</span>
                <input
                  type="text"
                  placeholder="Введите имя"
                  value={name}
                  required
                  disabled={isRegistering}
                  onChange={(event) => {
                    setName(event.target.value)
                    setFormError('')
                  }}
                />
              </label>

              <label className="registerField">
                <span>Фамилия</span>
                <input
                  type="text"
                  placeholder="Введите фамилию"
                  value={surname}
                  required
                  disabled={isRegistering}
                  onChange={(event) => {
                    setSurname(event.target.value)
                    setFormError('')
                  }}
                />
              </label>

              <label className="registerField">
                <span>E-mail</span>
                <input
                  type="email"
                  placeholder="Введите e-mail"
                  value={email}
                  required
                  disabled={isRegistering}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setFormError('')
                  }}
                />
              </label>

              <div className="registerPasswordBlock">
                <label className="registerField registerPasswordField">
                  <span>Пароль</span>

                  <div className="registerPasswordInput">
                    <input
                      type={isPasswordVisible ? 'text' : 'password'}
                      placeholder="Введите пароль"
                      value={password}
                      required
                      disabled={isRegistering}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setFormError('')
                      }}
                    />

                    <button
                      className="registerPasswordToggle"
                      type="button"
                      aria-label={isPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                      disabled={isRegistering}
                      onClick={() => setIsPasswordVisible((value) => !value)}
                    >
                      <EyeSlashIcon />
                    </button>
                  </div>
                </label>

                <div className="registerPasswordRules">
                  <p>Минимум 8 символов</p>
                  <p>Содержит цифру или символ</p>
                </div>
              </div>

              <label className="registerField registerPasswordField">
                <span>Повтор пароля</span>

                <div className="registerPasswordInput">
                  <input
                    type={isRepeatPasswordVisible ? 'text' : 'password'}
                    placeholder="Повторите пароль"
                    value={repeatPassword}
                    required
                    disabled={isRegistering}
                    onChange={(event) => {
                      setRepeatPassword(event.target.value)
                      setFormError('')
                    }}
                  />

                  <button
                    className="registerPasswordToggle"
                    type="button"
                    aria-label={isRepeatPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                    disabled={isRegistering}
                    onClick={() => setIsRepeatPasswordVisible((value) => !value)}
                  >
                    <EyeSlashIcon />
                  </button>
                </div>
              </label>

              <div className="registerAgreementBlock">
                <p>Нажимая Зарегистрироваться. Вы соглашаетесь</p>

                <p>
                  с <a href="#terms">Условиями</a> и{' '}
                  <a href="#privacy">Политикой конфиденциальности</a>
                </p>
              </div>

              {formError && (
                <p
                  className="registerCodeErrorMessage"
                  role="alert"
                  style={{
                    width: '420px',
                    height: 'auto',
                    margin: 0,
                    cursor: 'default',
                    textDecoration: 'none',
                  }}
                >
                  {formError}
                </p>
              )}

              <button className="registerSubmitButton" type="submit" disabled={isRegistering}>
                {isRegistering ? 'Отправляем код...' : 'Зарегистрироваться'}
              </button>

              <div className="registerLoginLink">
                <span>Есть аккаунт?</span>

                <button type="button" disabled={isRegistering} onClick={onOpenLogin}>
                  Войти
                </button>
              </div>
            </form>
          </>
        )}

        {registerStep === 'emailConfirm' && (
          <>
            {!isConfirmationCodeInvalid && (
              <div className="registerModalTop">
                <button
                  className="registerModalClose"
                  type="button"
                  aria-label="Закрыть"
                  onClick={onClose}
                >
                  <CloseIcon />
                </button>
              </div>
            )}

            <div className="registerConfirmHeaderRow">
              <button
                className="registerBackButton"
                type="button"
                aria-label="Вернуться назад"
                disabled={isConfirming || isResending}
                onClick={handleBackToForm}
              >
                <ArrowLeftIcon />
              </button>

              <div className="registerConfirmTitleWrap">
                <h2 id="register-modal-title">Регистрация</h2>
              </div>
            </div>

            <div className="registerConfirmStepBlock">
              <p>Шаг 2 из 2</p>
            </div>

            <div className="registerEmailConfirmContent">
              <div className="registerEmailConfirmIntro">
                <h3>Подтвердите ваш E-mail</h3>

                {!isConfirmationCodeInvalid && (
                  <p>
                    {isConfirming
                      ? 'Проверяем код...'
                      : `Введите код, отправленный на почту ${displayEmail}`}
                  </p>
                )}
              </div>

              <div
                className={
                  isConfirmationCodeInvalid
                    ? 'registerCodeArea registerCodeAreaInvalid'
                    : 'registerCodeArea'
                }
              >
                <div className="registerCodeInputs" aria-label="Код подтверждения">
                  {confirmationCode.map((digit, index) => (
                    <input
                      key={`confirmation-code-${index}`}
                      ref={(element) => {
                        codeInputRefs.current[index] = element
                      }}
                      className={isConfirmationCodeInvalid ? 'isInvalid' : undefined}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={digit}
                      maxLength={1}
                      disabled={isConfirming || isResending}
                      aria-label={`Цифра ${index + 1}`}
                      onChange={(event) => handleCodeChange(index, event.target.value)}
                      onKeyDown={(event) => handleCodeKeyDown(event, index)}
                      onPaste={handleCodePaste}
                    />
                  ))}
                </div>

                {isConfirmationCodeInvalid && (
                  <p
                    className="registerCodeErrorMessage"
                    role="alert"
                    style={{ margin: 0, cursor: 'default', textDecoration: 'none' }}
                  >
                    {confirmationError}
                  </p>
                )}
              </div>

              <div className="registerConfirmLinks">
                <button
                  className={resendSeconds > 0 ? 'registerResendButton' : 'registerChangeEmailButton'}
                  type="button"
                  disabled={resendSeconds > 0 || isResending || isConfirming}
                  onClick={() => void handleResendCode()}
                >
                  {isResending
                    ? 'Отправляем новый код...'
                    : resendSeconds > 0
                      ? `Отправить снова через ${resendTimer}`
                      : 'Отправить код снова'}
                </button>

                <button
                  className="registerChangeEmailButton"
                  type="button"
                  disabled={isConfirming || isResending}
                  onClick={handleBackToForm}
                >
                  Ввести другой адрес
                </button>
              </div>
            </div>
          </>
        )}

        {registerStep === 'success' && (
          <>
            <div className="registerSuccessHeader">
              <div className="registerSuccessTitleWrap">
                <h2 id="register-modal-title">Регистрация завершена</h2>
              </div>
            </div>

            <div className="registerSuccessStepBlock">
              <p>Шаг 2 из 2</p>
            </div>

            <div className="registerSuccessContent">
              <button
                className="registerSuccessLoginButton"
                type="button"
                onClick={() => {
                  window.location.href = '/app'
                }}
              >
                Перейти в CRM
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

export default RegisterModal
