import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
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
type PasswordResetResponse = { message: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_HAS_DIGIT_OR_SPECIAL = /[0-9]|[^A-Za-zА-Яа-яЁё]/
const RESEND_DELAY_SECONDS = 60
const CODE_LIFETIME_SECONDS = 10 * 60
const SUCCESS_REDIRECT_DELAY_MS = 1500

function createEmptyCode() { return ['', '', '', ''] }
function formatCountdown(totalSeconds: number) {
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}
function getRequestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function PasswordResetModal({ initialEmail = '', onClose, onOpenLogin }: PasswordResetModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const confirmRef = useRef<HTMLDivElement | null>(null)
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const isConfirmingRef = useRef(false)

  const [resetStep, setResetStep] = useState<PasswordResetStep>('email')
  const [email, setEmail] = useState(initialEmail)
  const [codeEmail, setCodeEmail] = useState('')
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
  const [isCancellingReset, setIsCancellingReset] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [codeExpiresSeconds, setCodeExpiresSeconds] = useState(0)
  const [isCodeBlocked, setIsCodeBlocked] = useState(false)
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)

  const normalizedEmail = email.trim().toLowerCase()
  const activeResetEmail = codeEmail || normalizedEmail
  const isEmailValid = Boolean(normalizedEmail && normalizedEmail.length <= 255 && EMAIL_PATTERN.test(normalizedEmail))
  const passwordHasMinLength = newPassword.length >= 8
  const passwordHasRequiredCharacter = PASSWORD_HAS_DIGIT_OR_SPECIAL.test(newPassword)
  const passwordsMatch = Boolean(newPassword && repeatPassword && newPassword === repeatPassword)
  const isPasswordFormValid = Boolean(
    newPassword && repeatPassword && newPassword.length <= 255 && passwordHasMinLength
    && passwordHasRequiredCharacter && passwordsMatch,
  )
  const isBusy = isSendingCode || isConfirmingCode || isSavingPassword || isCancellingReset
  const codeExpired = resetStep === 'code' && codeExpiresSeconds === 0
  const displayedCodeError = codeError || (codeExpired ? 'Срок действия кода истёк. Запросите новый код.' : '')

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = originalOverflow }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (resetStep === 'email') modalRef.current?.querySelector<HTMLInputElement>('input[type="email"]')?.focus()
      if (resetStep === 'code') codeInputRefs.current[0]?.focus()
      if (resetStep === 'newPassword') modalRef.current?.querySelector<HTMLInputElement>('input[name="new-password"]')?.focus()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [resetStep])

  useEffect(() => {
    if (resetStep !== 'code') return
    const intervalId = window.setInterval(() => {
      setResendSeconds((value) => Math.max(0, value - 1))
      setCodeExpiresSeconds((value) => Math.max(0, value - 1))
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [resetStep])

  useEffect(() => {
    if (resetStep !== 'success') return
    const timeoutId = window.setTimeout(() => onOpenLogin(activeResetEmail), SUCCESS_REDIRECT_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
  }, [activeResetEmail, onOpenLogin, resetStep])

  const startCodeTimers = () => {
    setResendSeconds(RESEND_DELAY_SECONDS)
    setCodeExpiresSeconds(CODE_LIFETIME_SECONDS)
  }

  const cancelServerReset = async (targetEmail = activeResetEmail) => {
    const normalizedTarget = targetEmail.trim().toLowerCase()
    if (!normalizedTarget) return
    await apiRequest('/api/auth/reset-password/cancel', {
      method: 'POST',
      body: { email: normalizedTarget },
      suppressGlobalErrorToast: true,
    })
  }

  const shouldConfirmClose = () => {
    if (resetStep === 'email') return Boolean(email)
    if (resetStep === 'code') return true
    if (resetStep === 'newPassword') return Boolean(newPassword || repeatPassword)
    return false
  }

  const cancelConfirmedResetAndClose = async () => {
    if (isCancellingReset) return
    try {
      setIsCancellingReset(true)
      await cancelServerReset()
      onClose()
    } catch (error) {
      setPasswordError(getRequestErrorMessage(error, 'Не удалось прервать восстановление пароля.'))
      setIsCloseConfirmOpen(false)
    } finally {
      setIsCancellingReset(false)
    }
  }

  const requestClose = () => {
    if (isBusy || resetStep === 'success') return

    if (resetStep === 'newPassword' && !shouldConfirmClose()) {
      void cancelConfirmedResetAndClose()
      return
    }

    if (shouldConfirmClose()) setIsCloseConfirmOpen(true)
    else onClose()
  }

  const handleConfirmedClose = async () => {
    if (resetStep === 'newPassword') {
      await cancelConfirmedResetAndClose()
      return
    }
    onClose()
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isCloseConfirmOpen) requestClose()
  }

  const getFocusableElements = (container: HTMLElement | null) => {
    if (!container) return []
    return Array.from(container.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), a[href]:not([tabindex="-1"])',
    )).filter((element) => element.offsetParent !== null)
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
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const handleBack = () => {
    if (isBusy) return
    if (resetStep === 'code') {
      setCodeError('')
      setEmail(activeResetEmail)
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
    if (!isEmailValid || isSendingCode) return

    if (codeExpiresSeconds > 0 && codeEmail === normalizedEmail) {
      setResetStep('code')
      return
    }

    try {
      setIsSendingCode(true)
      setEmailError('')

      if (codeEmail && codeEmail !== normalizedEmail) {
        await cancelServerReset(codeEmail)
        setConfirmationCode(createEmptyCode())
        setCodeError('')
        setIsCodeBlocked(false)
        setResendSeconds(0)
        setCodeExpiresSeconds(0)
      }

      await apiRequest<PasswordResetResponse>('/api/auth/forgot-password', {
        method: 'POST', timeoutMs: 10_000, body: { email: normalizedEmail },
      })
      setEmail(normalizedEmail)
      setCodeEmail(normalizedEmail)
      setConfirmationCode(createEmptyCode())
      setCodeError('')
      setIsCodeBlocked(false)
      startCodeTimers()
      setResetStep('code')
    } catch (error) {
      setEmailError(getRequestErrorMessage(error, 'Не удалось отправить код. Проверьте e-mail и попробуйте позже.'))
    } finally { setIsSendingCode(false) }
  }

  async function handleCodeSubmit(code: string) {
    if (code.length !== 4 || isConfirmingRef.current || isCodeBlocked) return
    if (codeExpiresSeconds === 0) { setCodeError('Срок действия кода истёк. Запросите новый код.'); return }
    try {
      isConfirmingRef.current = true
      setIsConfirmingCode(true)
      setCodeError('')
      await apiRequest<PasswordResetResponse>('/api/auth/reset-password/confirm', {
        method: 'POST', body: { email: activeResetEmail, code },
      })
      setEmail(activeResetEmail)
      setResetStep('newPassword')
    } catch (error) {
      const message = getRequestErrorMessage(error, 'Проверьте правильность ввода или отправьте новый код.')
      setCodeError(message)
      if (message.includes('Превышено количество попыток')) { setIsCodeBlocked(true); setResendSeconds(0) }
      if (message.includes('Срок действия кода истёк')) setResendSeconds(0)
    } finally {
      isConfirmingRef.current = false
      setIsConfirmingCode(false)
    }
  }

  const handleCodeChange = (index: number, value: string) => {
    if (isConfirmingCode || isCodeBlocked) return
    const nextCode = [...confirmationCode]
    const nextValue = value.replace(/\D/g, '').slice(-1)
    nextCode[index] = nextValue
    setConfirmationCode(nextCode)
    setCodeError('')
    if (nextValue && index < 3) codeInputRefs.current[index + 1]?.focus()
    const code = nextCode.join('')
    if (code.length === 4) void handleCodeSubmit(code)
  }

  const handleCodePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (isConfirmingCode || isCodeBlocked) return
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (!pasted) return
    event.preventDefault()
    const next = createEmptyCode()
    pasted.split('').forEach((digit, index) => { next[index] = digit })
    setConfirmationCode(next)
    setCodeError('')
    if (pasted.length === 4) void handleCodeSubmit(pasted)
    else codeInputRefs.current[pasted.length]?.focus()
  }

  const handleCodeKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Backspace' && !confirmationCode[index] && index > 0) codeInputRefs.current[index - 1]?.focus()
    if (event.key === 'Enter' && confirmationCode.join('').length === 4) {
      event.preventDefault()
      void handleCodeSubmit(confirmationCode.join(''))
    }
  }

  const handleResendCode = async () => {
    if ((resendSeconds > 0 && !codeExpired) || isSendingCode || isConfirmingCode) return
    try {
      setIsSendingCode(true)
      setCodeError('')
      await apiRequest<PasswordResetResponse>('/api/auth/forgot-password', { method: 'POST', body: { email: activeResetEmail } })
      setConfirmationCode(createEmptyCode())
      setIsCodeBlocked(false)
      startCodeTimers()
      window.setTimeout(() => codeInputRefs.current[0]?.focus(), 0)
    } catch (error) {
      setCodeError(getRequestErrorMessage(error, 'Не удалось отправить код. Проверьте e-mail и попробуйте позже.'))
    } finally { setIsSendingCode(false) }
  }

  const handleChangeEmail = async () => {
    if (isBusy) return
    try {
      setIsCancellingReset(true)
      await cancelServerReset()
      setEmail('')
      setCodeEmail('')
      setEmailError('')
      setConfirmationCode(createEmptyCode())
      setCodeError('')
      setIsCodeBlocked(false)
      setResendSeconds(0)
      setCodeExpiresSeconds(0)
      setResetStep('email')
    } catch (error) {
      setCodeError(getRequestErrorMessage(error, 'Не удалось сменить e-mail. Попробуйте позже.'))
    } finally {
      setIsCancellingReset(false)
    }
  }

  const handlePasswordSubmit = async () => {
    if (!isPasswordFormValid || isSavingPassword) return
    try {
      setIsSavingPassword(true)
      setPasswordError('')
      await apiRequest<PasswordResetResponse>('/api/auth/reset-password', {
        method: 'POST', body: { email: activeResetEmail, new_password: newPassword },
      })
      setResetStep('success')
    } catch (error) {
      const message = getRequestErrorMessage(error, 'Не удалось изменить пароль. Попробуйте позже.')
      setPasswordError(message)
      if (message.includes('Срок восстановления истёк')) {
        setNewPassword('')
        setRepeatPassword('')
        setConfirmationCode(createEmptyCode())
        setResendSeconds(0)
        setCodeExpiresSeconds(0)
        setCodeEmail('')
        setEmailError(message)
        setResetStep('email')
      }
    } finally { setIsSavingPassword(false) }
  }

  const hasCodeError = Boolean(displayedCodeError)
  const modalClassName = [
    'passwordResetModal',
    resetStep === 'email' ? 'passwordResetModalEmail' : '',
    resetStep === 'code' ? 'passwordResetModalCode' : '',
    resetStep === 'newPassword' ? 'passwordResetModalNewPassword' : '',
    resetStep === 'success' ? 'passwordResetModalSuccess' : '',
    hasCodeError ? 'passwordResetModalCodeInvalid' : '',
  ].filter(Boolean).join(' ')

  const closeTabIndex = resetStep === 'email' ? 3 : 8

  return (
    <div className="passwordResetOverlay" role="presentation" onMouseDown={handleOverlayMouseDown} onKeyDown={handleKeyDown}>
      <div className={modalClassName} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="password-reset-modal-title">
        {resetStep !== 'success' && (
          <div className="passwordResetTop">
            <button className="passwordResetClose" tabIndex={closeTabIndex} type="button" aria-label="Закрыть" disabled={isBusy} onClick={requestClose}><CloseIcon /></button>
          </div>
        )}

        {resetStep === 'email' && (
          <>
            <div className="passwordResetTitleBlock"><h2 id="password-reset-modal-title">Восстановление пароля</h2></div>
            <div className="passwordResetStepBlock"><p>Шаг 1 из 3</p></div>
            <form className="passwordResetEmailForm" noValidate onSubmit={(event) => { event.preventDefault(); void handleEmailSubmit() }}>
              <label className="passwordResetField">
                <span>E-mail</span>
                <input tabIndex={1} type="email" maxLength={255} placeholder="Введите e-mail" value={email} disabled={isSendingCode}
                  onBlur={() => { if (email && !isEmailValid) setEmailError('Неверный e-mail.') }}
                  onChange={(event) => { setEmail(event.target.value); setEmailError('') }} />
              </label>
              {emailError && <p className="passwordResetEmailErrorText" role="alert">{emailError}</p>}
              <button className="passwordResetSubmitButton" tabIndex={2} type="submit" disabled={!isEmailValid || isSendingCode}>
                {isSendingCode ? <><span className="passwordResetButtonSpinner" aria-hidden="true" />Отправка...</> : 'Отправить код'}
              </button>
            </form>
          </>
        )}

        {resetStep === 'code' && (
          <>
            <div className="passwordResetHeaderRow">
              <button className="passwordResetBackButton" tabIndex={1} type="button" aria-label="Назад" disabled={isBusy} onClick={handleBack}><ArrowLeftIcon /></button>
              <div className="passwordResetHeaderTitleWrap"><h2 id="password-reset-modal-title">Восстановление пароля</h2></div>
            </div>
            <div className="passwordResetStepBlock"><p>Шаг 2 из 3</p></div>
            <div className="passwordResetCodeContent">
              <div className="passwordResetCodeIntro">
                <h3>Подтвердите ваш E-mail</h3>
                <p className="passwordResetEmailPreview" title={activeResetEmail}>Введите код, отправленный на почту {activeResetEmail}</p>
              </div>
              <div className={hasCodeError ? 'passwordResetCodeArea passwordResetCodeAreaInvalid' : 'passwordResetCodeArea'}>
                <div className="passwordResetCodeInputs" aria-label="Код подтверждения">
                  {confirmationCode.map((digit, index) => (
                    <input key={`password-reset-code-${index}`} ref={(element) => { codeInputRefs.current[index] = element }}
                      tabIndex={index + 2} className={hasCodeError ? 'isInvalid' : undefined} type="text" inputMode="numeric"
                      autoComplete={index === 0 ? 'one-time-code' : 'off'} value={digit} maxLength={1} aria-label={`Цифра ${index + 1}`}
                      disabled={isBusy || isCodeBlocked} onChange={(event) => handleCodeChange(index, event.target.value)}
                      onPaste={handleCodePaste} onKeyDown={(event) => handleCodeKeyDown(event, index)} />
                  ))}
                </div>
                {hasCodeError && <p className="passwordResetCodeErrorText" role="alert">{displayedCodeError}</p>}
              </div>
              <p className="passwordResetCodeLifetime">Код действителен 10 минут.</p>
              <div className="passwordResetCodeLinks">
                <button className={resendSeconds > 0 && !codeExpired ? 'passwordResetResendButton' : 'passwordResetChangeEmailButton'}
                  tabIndex={resendSeconds > 0 && !codeExpired ? -1 : 6} type="button"
                  disabled={(resendSeconds > 0 && !codeExpired) || isSendingCode || isConfirmingCode}
                  onClick={() => void handleResendCode()}>
                  {isSendingCode ? 'Отправка...' : resendSeconds > 0 && !codeExpired ? `Отправить снова через ${formatCountdown(resendSeconds)}` : 'Отправить код повторно'}
                </button>
                <button className="passwordResetChangeEmailButton" tabIndex={7} type="button" disabled={isBusy} onClick={() => void handleChangeEmail()}>Ввести другой адрес</button>
              </div>
            </div>
          </>
        )}

        {resetStep === 'newPassword' && (
          <>
            <div className="passwordResetHeaderRow">
              <button className="passwordResetBackButton" tabIndex={1} type="button" aria-label="Назад" disabled={isSavingPassword} onClick={handleBack}><ArrowLeftIcon /></button>
              <div className="passwordResetHeaderTitleWrap"><h2 id="password-reset-modal-title">Восстановление пароля</h2></div>
            </div>
            <div className="passwordResetStepBlock"><p>Шаг 3 из 3</p></div>
            <form className="passwordResetPasswordForm" noValidate onSubmit={(event) => { event.preventDefault(); void handlePasswordSubmit() }}>
              <div className="passwordResetPasswordBlock">
                <label className="passwordResetField passwordResetPasswordField">
                  <span>Новый пароль</span>
                  <div className="passwordResetPasswordInput">
                    <input name="new-password" tabIndex={2} type={isNewPasswordVisible ? 'text' : 'password'} maxLength={255} placeholder="Введите новый пароль" value={newPassword}
                      disabled={isSavingPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordError('') }} />
                    <button className="passwordResetPasswordToggle" tabIndex={3} type="button" aria-label={isNewPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                      disabled={isSavingPassword} onClick={() => setIsNewPasswordVisible((value) => !value)}>{isNewPasswordVisible ? <EyeIcon /> : <EyeSlashIcon />}</button>
                  </div>
                </label>
                <div className="passwordResetPasswordRules">
                  <p className={passwordHasMinLength ? 'isValid' : 'isInvalid'}>Минимум 8 символов</p>
                  <p className={passwordHasRequiredCharacter ? 'isValid' : 'isInvalid'}>Содержит цифру или специальный символ</p>
                </div>
              </div>
              <label className="passwordResetField passwordResetPasswordField">
                <span>Повтор пароля</span>
                <div className="passwordResetPasswordInput">
                  <input tabIndex={4} type={isRepeatPasswordVisible ? 'text' : 'password'} maxLength={255} placeholder="Повторите пароль" value={repeatPassword}
                    disabled={isSavingPassword} onChange={(event) => { setRepeatPassword(event.target.value); setPasswordError('') }} />
                  <button className="passwordResetPasswordToggle" tabIndex={5} type="button" aria-label={isRepeatPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                    disabled={isSavingPassword} onClick={() => setIsRepeatPasswordVisible((value) => !value)}>{isRepeatPasswordVisible ? <EyeIcon /> : <EyeSlashIcon />}</button>
                </div>
              </label>
              {repeatPassword && !passwordsMatch && <p className="passwordResetPasswordErrorText" role="alert">Пароли не совпадают.</p>}
              {passwordError && <p className="passwordResetPasswordErrorText" role="alert">{passwordError}</p>}
              <button className="passwordResetSubmitButton" tabIndex={6} type="submit" disabled={!isPasswordFormValid || isSavingPassword}>
                {isSavingPassword ? <><span className="passwordResetButtonSpinner" aria-hidden="true" />Сохранение...</> : 'Сохранить пароль'}
              </button>
            </form>
          </>
        )}

        {resetStep === 'success' && (
          <>
            <div className="passwordResetSuccessHeader"><h2 id="password-reset-modal-title">Пароль успешно восстановлен</h2></div>
            <div className="passwordResetSuccessStepBlock"><p>Шаг 3 из 3</p></div>
          </>
        )}
      </div>

      {isCloseConfirmOpen && (
        <div className="passwordResetCloseConfirmOverlay" role="presentation">
          <div className="passwordResetCloseConfirm" ref={confirmRef} role="alertdialog" aria-modal="true" aria-labelledby="password-reset-close-title">
            <h3 id="password-reset-close-title">Введённые данные будут потеряны. Закрыть окно?</h3>
            <div className="passwordResetCloseConfirmActions">
              <button type="button" disabled={isCancellingReset} onClick={() => void handleConfirmedClose()}>Закрыть</button>
              <button type="button" autoFocus disabled={isCancellingReset} onClick={() => setIsCloseConfirmOpen(false)}>Остаться</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CloseIcon() { return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5.2 12 10.8l5.6-5.6 1.2 1.2-5.6 5.6 5.6 5.6-1.2 1.2L12 13.2l-5.6 5.6-1.2-1.2 5.6-5.6-5.6-5.6 1.2-1.2Z" fill="currentColor" /></svg> }
function ArrowLeftIcon() { return <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><path d="M18.2 9.5 8.4 19.3a1 1 0 0 0 0 1.4l9.8 9.8 1.9-1.9-7.5-7.5h19.5v-2.7H12.6l7.5-7.5-1.9-1.4Z" fill="currentColor" /></svg> }
function EyeSlashIcon() { return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.3 4.6 4.6 3.3l16.1 16.1-1.3 1.3-3-3A11.9 11.9 0 0 1 12 18.6C6.7 18.6 3.1 14.8 1.6 12c.8-1.5 2.2-3.2 4.1-4.5L3.3 4.6Zm4 4c-1.5.9-2.7 2.1-3.5 3.4 1.3 2 4.2 4.6 8.2 4.6.9 0 1.8-.1 2.6-.4l-1.8-1.8a3 3 0 0 1-3.2-3.2L7.3 8.6ZM12 5.4c5.3 0 8.9 3.8 10.4 6.6-.6 1.1-1.5 2.3-2.7 3.3l-1.4-1.4c.8-.6 1.4-1.3 1.9-1.9-1.3-2-4.2-4.6-8.2-4.6-.5 0-1 .1-1.5.1L8.9 5.9c1-.3 2-.5 3.1-.5Zm-.3 3.6h.3a3 3 0 0 1 3 3v.3L11.7 9Z" fill="currentColor" /></svg> }
function EyeIcon() { return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.4c5.3 0 8.9 3.8 10.4 6.6-1.5 2.8-5.1 6.6-10.4 6.6S3.1 14.8 1.6 12C3.1 9.2 6.7 5.4 12 5.4Zm0 2C8 7.4 5.1 10 3.8 12c1.3 2 4.2 4.6 8.2 4.6s6.9-2.6 8.2-4.6C18.9 10 16 7.4 12 7.4Zm0 1.6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" fill="currentColor" /></svg> }

export default PasswordResetModal