import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  confirmRegistration,
  expireRegistration,
  resendRegistrationCode,
  startRegistration,
  type RegisterRequest,
} from './shared/api/authApi'
import { ApiError } from './shared/api/apiClient'
import { setAccessToken } from './shared/api/authToken'
import './RegisterModal.css'

type RegisterModalProps = {
  onClose: () => void
  onOpenLogin?: () => void
}

type RegisterStep = 'form' | 'emailConfirm' | 'success'
type FieldName = 'name' | 'surname' | 'email' | 'password' | 'repeatPassword'
type FieldErrors = Partial<Record<FieldName, string>>

type RegistrationDraft = {
  name: string
  surname: string
  email: string
  password: string
  repeatPassword: string
  codeSentAt?: number
  codeExpiresAt?: number
}

const PERSON_NAME_PATTERN = /^[A-Za-zА-Яа-яЁё -]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_HAS_DIGIT_OR_SPECIAL_PATTERN = /[0-9]|[^A-Za-zА-Яа-яЁё]/
const RESEND_TIMEOUT_SECONDS = 60
const CODE_TTL_MS = 10 * 60 * 1000
const REGISTER_DRAFT_KEY = 'prodavan_registration_draft'

function loadRegistrationDraft(): RegistrationDraft {
  try {
    const raw = window.sessionStorage.getItem(REGISTER_DRAFT_KEY)
    if (!raw) {
      return { name: '', surname: '', email: '', password: '', repeatPassword: '' }
    }

    const parsed = JSON.parse(raw) as Partial<RegistrationDraft>
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      surname: typeof parsed.surname === 'string' ? parsed.surname : '',
      email: typeof parsed.email === 'string' ? parsed.email : '',
      password: typeof parsed.password === 'string' ? parsed.password : '',
      repeatPassword: typeof parsed.repeatPassword === 'string' ? parsed.repeatPassword : '',
      codeSentAt: typeof parsed.codeSentAt === 'number' ? parsed.codeSentAt : undefined,
      codeExpiresAt: typeof parsed.codeExpiresAt === 'number' ? parsed.codeExpiresAt : undefined,
    }
  } catch {
    return { name: '', surname: '', email: '', password: '', repeatPassword: '' }
  }
}

function RegisterModal({ onClose, onOpenLogin }: RegisterModalProps) {
  const initialDraft = useMemo(loadRegistrationDraft, [])
  const hasActivePendingRegistration = Boolean(
    initialDraft.email
      && initialDraft.codeExpiresAt
      && initialDraft.codeExpiresAt > Date.now(),
  )

  const modalRef = useRef<HTMLDivElement | null>(null)
  const confirmRef = useRef<HTMLDivElement | null>(null)
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const isConfirmingRef = useRef(false)

  const [registerStep, setRegisterStep] = useState<RegisterStep>(
    hasActivePendingRegistration ? 'emailConfirm' : 'form',
  )
  const [name, setName] = useState(initialDraft.name)
  const [surname, setSurname] = useState(initialDraft.surname)
  const [email, setEmail] = useState(initialDraft.email)
  const [password, setPassword] = useState(initialDraft.password)
  const [repeatPassword, setRepeatPassword] = useState(initialDraft.repeatPassword)
  const [codeSentAt, setCodeSentAt] = useState<number | undefined>(initialDraft.codeSentAt)
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | undefined>(initialDraft.codeExpiresAt)
  const [confirmationCode, setConfirmationCode] = useState(['', '', '', ''])
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  const [confirmationError, setConfirmationError] = useState('')
  const [resendSeconds, setResendSeconds] = useState(() => {
    if (!initialDraft.codeSentAt) {
      return RESEND_TIMEOUT_SECONDS
    }
    return Math.max(
      0,
      RESEND_TIMEOUT_SECONDS - Math.floor((Date.now() - initialDraft.codeSentAt) / 1000),
    )
  })
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isRepeatPasswordVisible, setIsRepeatPasswordVisible] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [isChangingEmail, setIsChangingEmail] = useState(false)
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [isCodeBlocked, setIsCodeBlocked] = useState(false)

  const passwordHasMinLength = password.length >= 8
  const passwordHasRequiredCharacter = PASSWORD_HAS_DIGIT_OR_SPECIAL_PATTERN.test(password)
  const isFormDirty = Boolean(name || surname || email || password || repeatPassword)

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  useEffect(() => {
    if (registerStep === 'success') {
      window.sessionStorage.removeItem(REGISTER_DRAFT_KEY)
      const timeoutId = window.setTimeout(() => {
        window.location.href = '/app'
      }, 1500)
      return () => window.clearTimeout(timeoutId)
    }

    const draft: RegistrationDraft = {
      name,
      surname,
      email,
      password,
      repeatPassword,
      codeSentAt,
      codeExpiresAt,
    }
    window.sessionStorage.setItem(REGISTER_DRAFT_KEY, JSON.stringify(draft))
  }, [codeExpiresAt, codeSentAt, email, name, password, registerStep, repeatPassword, surname])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (registerStep === 'form') {
        modalRef.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus()
      } else if (registerStep === 'emailConfirm') {
        codeInputRefs.current[0]?.focus()
      }
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [registerStep])

  useEffect(() => {
    if (registerStep !== 'emailConfirm') {
      return
    }

    if (codeExpiresAt && Date.now() >= codeExpiresAt) {
      setResendSeconds(0)
      return
    }

    if (resendSeconds <= 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1000)

    return () => window.clearTimeout(timeoutId)
  }, [codeExpiresAt, registerStep, resendSeconds])

  const requestClose = () => {
    if (registerStep === 'success') {
      return
    }
    if (registerStep === 'emailConfirm') {
      onClose()
      return
    }
    if (isFormDirty) {
      setIsCloseConfirmOpen(true)
      return
    }
    onClose()
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isCloseConfirmOpen) {
      requestClose()
    }
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
      if (isCloseConfirmOpen) {
        setIsCloseConfirmOpen(false)
      } else {
        requestClose()
      }
      return
    }

    if (event.key !== 'Tab') {
      return
    }

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

  const getRegistrationData = (): RegisterRequest => ({
    name: name.trim(),
    surname: surname.trim(),
    email: email.trim().toLowerCase(),
    password,
  })

  const validateForm = () => {
    const data = getRegistrationData()
    const errors: FieldErrors = {}

    if (!data.name) errors.name = 'Заполните поле.'
    else if (data.name.length < 2 || data.name.length > 50 || !PERSON_NAME_PATTERN.test(data.name)) {
      errors.name = 'Имя должно содержать 2–50 символов: буквы, пробел или дефис.'
    }

    if (!data.surname) errors.surname = 'Заполните поле.'
    else if (
      data.surname.length < 2
      || data.surname.length > 50
      || !PERSON_NAME_PATTERN.test(data.surname)
    ) {
      errors.surname = 'Фамилия должна содержать 2–50 символов: буквы, пробел или дефис.'
    }

    if (!data.email) errors.email = 'Заполните поле.'
    else if (!EMAIL_PATTERN.test(data.email)) errors.email = 'Укажите корректный e-mail.'

    if (!password) errors.password = 'Заполните поле.'
    else if (
      password.length < 8
      || password.length > 255
      || !PASSWORD_HAS_DIGIT_OR_SPECIAL_PATTERN.test(password)
    ) {
      errors.password = 'Пароль не соответствует требованиям безопасности.'
    }

    if (!repeatPassword) errors.repeatPassword = 'Заполните поле.'
    else if (password !== repeatPassword) errors.repeatPassword = 'Пароли не совпадают.'

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const applyServerFieldError = (error: unknown) => {
    if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') return false
    const data = error.data as Record<string, unknown>
    const nextErrors: FieldErrors = {}
    const fields: FieldName[] = ['name', 'surname', 'email', 'password', 'repeatPassword']

    for (const field of fields) {
      const value = data[field]
      const message = Array.isArray(value) ? value.find((item) => typeof item === 'string') : value
      if (typeof message === 'string') nextErrors[field] = message
    }

    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors)
      return true
    }
    return false
  }

  const handleRegisterSubmit = async () => {
    if (isRegistering || !validateForm()) return

    const registrationData = getRegistrationData()
    const hasCurrentCode = Boolean(
      codeExpiresAt && codeExpiresAt > Date.now() && registrationData.email === email.trim().toLowerCase(),
    )

    try {
      setIsRegistering(true)
      setFormError('')
      await startRegistration(registrationData)

      setEmail(registrationData.email)
      setConfirmationCode(['', '', '', ''])
      setConfirmationError('')
      setIsCodeBlocked(false)

      if (!hasCurrentCode) {
        const sentAt = Date.now()
        setCodeSentAt(sentAt)
        setCodeExpiresAt(sentAt + CODE_TTL_MS)
        setResendSeconds(RESEND_TIMEOUT_SECONDS)
      }
      setRegisterStep('emailConfirm')
    } catch (error) {
      if (!applyServerFieldError(error)) {
        setFormError(error instanceof Error ? error.message : 'Не удалось отправить код подтверждения')
      }
    } finally {
      setIsRegistering(false)
    }
  }

  const handleBackToForm = () => {
    setConfirmationCode(['', '', '', ''])
    setConfirmationError('')
    setRegisterStep('form')
  }

  const handleChangeEmail = async () => {
    if (isChangingEmail || isConfirming || isResending) return
    try {
      setIsChangingEmail(true)
      if (email.trim()) await expireRegistration(email.trim().toLowerCase())
      setName('')
      setSurname('')
      setEmail('')
      setPassword('')
      setRepeatPassword('')
      setCodeSentAt(undefined)
      setCodeExpiresAt(undefined)
      setConfirmationCode(['', '', '', ''])
      setConfirmationError('')
      setFieldErrors({})
      setFormError('')
      setIsCodeBlocked(false)
      window.sessionStorage.removeItem(REGISTER_DRAFT_KEY)
      setRegisterStep('form')
    } catch (error) {
      setConfirmationError(error instanceof Error ? error.message : 'Не удалось завершить текущую регистрацию')
    } finally {
      setIsChangingEmail(false)
    }
  }

  const handleConfirmCode = async (code: string) => {
    if (code.length !== 4 || isConfirmingRef.current || isCodeBlocked) return

    try {
      isConfirmingRef.current = true
      setIsConfirming(true)
      setConfirmationError('')
      const data = await confirmRegistration({ email: email.trim().toLowerCase(), code })
      setAccessToken(data.access_token)
      setRegisterStep('success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось подтвердить код'
      setConfirmationError(message)
      if (message.includes('Превышено количество попыток')) {
        setIsCodeBlocked(true)
        setResendSeconds(0)
      }
      if (message.includes('Срок действия кода истёк')) {
        setResendSeconds(0)
      }
    } finally {
      isConfirmingRef.current = false
      setIsConfirming(false)
    }
  }

  const handleCodeChange = (index: number, value: string) => {
    if (isCodeBlocked) return
    const nextValue = value.replace(/\D/g, '').slice(-1)
    const nextCode = [...confirmationCode]
    nextCode[index] = nextValue
    setConfirmationCode(nextCode)
    setConfirmationError('')

    if (nextValue && index < 3) codeInputRefs.current[index + 1]?.focus()
    const joinedCode = nextCode.join('')
    if (joinedCode.length === 4) void handleConfirmCode(joinedCode)
  }

  const handleCodePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (isCodeBlocked) return
    const pastedCode = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (!pastedCode) return
    event.preventDefault()

    const nextCode = ['', '', '', '']
    pastedCode.split('').forEach((digit, index) => { nextCode[index] = digit })
    setConfirmationCode(nextCode)
    setConfirmationError('')

    if (pastedCode.length === 4) void handleConfirmCode(pastedCode)
    else codeInputRefs.current[pastedCode.length]?.focus()
  }

  const handleCodeKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Backspace' && !confirmationCode[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus()
    }
  }

  const handleResendCode = async () => {
    if (resendSeconds > 0 || isResending || isConfirming) return

    try {
      setIsResending(true)
      setConfirmationError('')
      await resendRegistrationCode(email.trim().toLowerCase())
      const sentAt = Date.now()
      setCodeSentAt(sentAt)
      setCodeExpiresAt(sentAt + CODE_TTL_MS)
      setConfirmationCode(['', '', '', ''])
      setIsCodeBlocked(false)
      setResendSeconds(RESEND_TIMEOUT_SECONDS)
      window.setTimeout(() => codeInputRefs.current[0]?.focus(), 0)
    } catch (error) {
      setConfirmationError(error instanceof Error ? error.message : 'Не удалось отправить новый код')
    } finally {
      setIsResending(false)
    }
  }

  const clearFieldError = (field: FieldName) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setFormError('')
  }

  const displayEmail = email.trim().toLowerCase()
  const resendTimer = `00:${String(resendSeconds).padStart(2, '0')}`
  const isConfirmationCodeInvalid = Boolean(confirmationError)
  const registerModalClassName = [
    'registerModal',
    registerStep === 'emailConfirm' ? 'registerModalEmailConfirm' : '',
    registerStep === 'success' ? 'registerModalSuccess' : '',
    isConfirmationCodeInvalid ? 'registerModalEmailConfirmInvalid' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="registerModalOverlay" role="presentation" onMouseDown={handleOverlayMouseDown} onKeyDown={handleKeyDown}>
      <div className={registerModalClassName} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="register-modal-title">
        {registerStep === 'form' && (
          <>
            <div className="registerModalTop">
              <button className="registerModalClose" type="button" tabIndex={10} aria-label="Закрыть" onClick={requestClose}>
                <CloseIcon />
              </button>
            </div>
            <div className="registerModalTitleBlock"><h2 id="register-modal-title">Регистрация</h2></div>
            <div className="registerModalStepBlock"><p>Шаг 1 из 2</p></div>

            <form className="registerModalForm" onSubmit={(event) => { event.preventDefault(); void handleRegisterSubmit() }} noValidate>
              <label className="registerField">
                <span>Имя</span>
                <input name="name" tabIndex={1} type="text" placeholder="Введите имя" value={name} disabled={isRegistering}
                  onChange={(event) => { setName(event.target.value); clearFieldError('name') }} />
                {fieldErrors.name && <small className="registerFieldError" role="alert">{fieldErrors.name}</small>}
              </label>

              <label className="registerField">
                <span>Фамилия</span>
                <input tabIndex={2} type="text" placeholder="Введите фамилию" value={surname} disabled={isRegistering}
                  onChange={(event) => { setSurname(event.target.value); clearFieldError('surname') }} />
                {fieldErrors.surname && <small className="registerFieldError" role="alert">{fieldErrors.surname}</small>}
              </label>

              <label className="registerField">
                <span>E-mail</span>
                <input tabIndex={3} type="email" placeholder="Введите e-mail" value={email} disabled={isRegistering}
                  onChange={(event) => { setEmail(event.target.value); clearFieldError('email') }} />
                {fieldErrors.email && <small className="registerFieldError" role="alert">{fieldErrors.email}</small>}
              </label>

              <div className="registerPasswordBlock">
                <label className="registerField registerPasswordField">
                  <span>Пароль</span>
                  <div className="registerPasswordInput">
                    <input tabIndex={4} type={isPasswordVisible ? 'text' : 'password'} placeholder="Введите пароль" value={password} maxLength={255} disabled={isRegistering}
                      onChange={(event) => { setPassword(event.target.value); clearFieldError('password') }} />
                    <button className="registerPasswordToggle" tabIndex={-1} type="button" aria-label={isPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'} disabled={isRegistering}
                      onClick={() => setIsPasswordVisible((value) => !value)}>
                      {isPasswordVisible ? <EyeIcon /> : <EyeSlashIcon />}
                    </button>
                  </div>
                  {fieldErrors.password && <small className="registerFieldError" role="alert">{fieldErrors.password}</small>}
                </label>
                <div className="registerPasswordRules">
                  <p className={passwordHasMinLength ? 'isValid' : 'isInvalid'}>Минимум 8 символов</p>
                  <p className={passwordHasRequiredCharacter ? 'isValid' : 'isInvalid'}>Содержит цифру или специальный символ</p>
                </div>
              </div>

              <label className="registerField registerPasswordField">
                <span>Повтор пароля</span>
                <div className="registerPasswordInput">
                  <input tabIndex={5} type={isRepeatPasswordVisible ? 'text' : 'password'} placeholder="Повторите пароль" value={repeatPassword} maxLength={255} disabled={isRegistering}
                    onChange={(event) => { setRepeatPassword(event.target.value); clearFieldError('repeatPassword') }} />
                  <button className="registerPasswordToggle" tabIndex={-1} type="button" aria-label={isRepeatPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'} disabled={isRegistering}
                    onClick={() => setIsRepeatPasswordVisible((value) => !value)}>
                    {isRepeatPasswordVisible ? <EyeIcon /> : <EyeSlashIcon />}
                  </button>
                </div>
                {fieldErrors.repeatPassword && <small className="registerFieldError" role="alert">{fieldErrors.repeatPassword}</small>}
              </label>

              <div className="registerAgreementBlock">
                <p>Нажимая Зарегистрироваться, Вы соглашаетесь с{' '}
                  <a tabIndex={6} href="#terms" target="_blank" rel="noreferrer">Условиями использования</a>{' '}и{' '}
                  <a tabIndex={7} href="#privacy" target="_blank" rel="noreferrer">Политикой конфиденциальности</a>
                </p>
              </div>

              {formError && <p className="registerCodeErrorMessage registerFormError" role="alert">{formError}</p>}

              <button className="registerSubmitButton" tabIndex={8} type="submit" disabled={isRegistering}>
                {isRegistering ? <><span className="registerButtonSpinner" aria-hidden="true" />Отправка кода...</> : 'Зарегистрироваться'}
              </button>

              <div className="registerLoginLink">
                <span>Есть аккаунт?</span>
                <button tabIndex={9} type="button" disabled={isRegistering} onClick={onOpenLogin}>Войти</button>
              </div>
            </form>
          </>
        )}

        {registerStep === 'emailConfirm' && (
          <>
            <div className="registerModalTop">
              <button className="registerModalClose" tabIndex={8} type="button" aria-label="Закрыть" onClick={requestClose}><CloseIcon /></button>
            </div>
            <div className="registerConfirmHeaderRow">
              <button className="registerBackButton" tabIndex={1} type="button" aria-label="Вернуться назад" disabled={isConfirming || isResending || isChangingEmail} onClick={handleBackToForm}><ArrowLeftIcon /></button>
              <div className="registerConfirmTitleWrap"><h2 id="register-modal-title">Регистрация</h2></div>
            </div>
            <div className="registerConfirmStepBlock"><p>Шаг 2 из 2</p></div>

            <div className="registerEmailConfirmContent">
              <div className="registerEmailConfirmIntro">
                <h3>Подтвердите ваш E-mail</h3>
                <p>{isConfirming ? 'Проверяем код...' : `Введите код, отправленный на почту ${displayEmail}`}</p>
              </div>

              <div className={isConfirmationCodeInvalid ? 'registerCodeArea registerCodeAreaInvalid' : 'registerCodeArea'}>
                <div className="registerCodeInputs" aria-label="Код подтверждения">
                  {confirmationCode.map((digit, index) => (
                    <input key={`confirmation-code-${index}`} ref={(element) => { codeInputRefs.current[index] = element }}
                      tabIndex={index + 2} className={isConfirmationCodeInvalid ? 'isInvalid' : undefined} type="text" inputMode="numeric"
                      autoComplete={index === 0 ? 'one-time-code' : 'off'} value={digit} maxLength={1}
                      disabled={isConfirming || isResending || isChangingEmail || isCodeBlocked} aria-label={`Цифра ${index + 1}`}
                      onChange={(event) => handleCodeChange(index, event.target.value)} onKeyDown={(event) => handleCodeKeyDown(event, index)} onPaste={handleCodePaste} />
                  ))}
                </div>
                {isConfirmationCodeInvalid && <p className="registerCodeErrorMessage" role="alert">{confirmationError}</p>}
              </div>

              <p className="registerCodeLifetime">Код действителен 10 минут.</p>
              <div className="registerConfirmLinks">
                <button className={resendSeconds > 0 ? 'registerResendButton' : 'registerChangeEmailButton'} tabIndex={resendSeconds > 0 ? -1 : 6}
                  type="button" disabled={resendSeconds > 0 || isResending || isConfirming || isChangingEmail} onClick={() => void handleResendCode()}>
                  {isResending ? 'Отправляем новый код...' : resendSeconds > 0 ? `Отправить снова через ${resendTimer}` : 'Отправить код повторно'}
                </button>
                <button className="registerChangeEmailButton" tabIndex={7} type="button" disabled={isConfirming || isResending || isChangingEmail}
                  onClick={() => void handleChangeEmail()}>{isChangingEmail ? 'Возвращаемся...' : 'Ввести другой адрес'}</button>
              </div>
            </div>
          </>
        )}

        {registerStep === 'success' && (
          <>
            <div className="registerSuccessHeader"><div className="registerSuccessTitleWrap"><h2 id="register-modal-title">Регистрация завершена</h2></div></div>
            <div className="registerSuccessStepBlock"><p>Шаг 2 из 2</p></div>
          </>
        )}
      </div>

      {isCloseConfirmOpen && (
        <div className="registerCloseConfirmOverlay" role="presentation">
          <div ref={confirmRef} className="registerCloseConfirm" role="alertdialog" aria-modal="true" aria-labelledby="register-close-confirm-title">
            <h3 id="register-close-confirm-title">Введённые данные будут потеряны. Закрыть окно?</h3>
            <div className="registerCloseConfirmActions">
              <button type="button" onClick={() => { window.sessionStorage.removeItem(REGISTER_DRAFT_KEY); onClose() }}>Закрыть</button>
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

function ArrowLeftIcon() {
  return <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><path d="M18.2 9.5 8.4 19.3a1 1 0 0 0 0 1.4l9.8 9.8 1.9-1.9-7.5-7.5h19.5v-2.7H12.6l7.5-7.5-1.9-1.4Z" fill="currentColor" /></svg>
}

function EyeIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.4c5.3 0 8.9 3.8 10.4 6.6-1.5 2.8-5.1 6.6-10.4 6.6S3.1 14.8 1.6 12C3.1 9.2 6.7 5.4 12 5.4Zm0 2c-4 0-6.9 2.6-8.2 4.6 1.3 2 4.2 4.6 8.2 4.6s6.9-2.6 8.2-4.6C18.9 10 16 7.4 12 7.4Zm0 1.6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" fill="currentColor" /></svg>
}

function EyeSlashIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.3 4.6 4.6 3.3l16.1 16.1-1.3 1.3-3-3A11.9 11.9 0 0 1 12 18.6C6.7 18.6 3.1 14.8 1.6 12c.8-1.5 2.2-3.2 4.1-4.5L3.3 4.6Zm4 4c-1.5.9-2.7 2.1-3.5 3.4 1.3 2 4.2 4.6 8.2 4.6.9 0 1.8-.1 2.6-.4l-1.8-1.8a3 3 0 0 1-3.2-3.2L7.3 8.6ZM12 5.4c5.3 0 8.9 3.8 10.4 6.6-.6 1.1-1.5 2.3-2.7 3.3l-1.4-1.4c.8-.6 1.4-1.3 1.9-1.9-1.3-2-4.2-4.6-8.2-4.6-.5 0-1 .1-1.5.1L8.9 5.9c1-.3 2-.5 3.1-.5Zm-.3 3.6h.3a3 3 0 0 1 3 3v.3L11.7 9Z" fill="currentColor" /></svg>
}

export default RegisterModal