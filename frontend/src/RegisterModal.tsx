import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import './RegisterModal.css'

type RegisterModalProps = {
  onClose: () => void
  onOpenLogin?: () => void
}

function RegisterModal({ onClose, onOpenLogin }: RegisterModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null)

  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
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

  return (
    <div
      className="registerModalOverlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
      onKeyDown={handleKeyDown}
    >
      <div
        className="registerModal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-modal-title"
      >
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
          }}
        >
          <label className="registerField">
            <span>Имя</span>
            <input type="text" placeholder="Введите имя" />
          </label>

          <label className="registerField">
            <span>Фамилия</span>
            <input type="text" placeholder="Введите фамилию" />
          </label>

          <label className="registerField">
            <span>E-mail</span>
            <input type="email" placeholder="Введите e-mail" />
          </label>

          <div className="registerPasswordBlock">
            <label className="registerField registerPasswordField">
              <span>Пароль</span>

              <div className="registerPasswordInput">
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  placeholder="Введите пароль"
                />

                <button
                  className="registerPasswordToggle"
                  type="button"
                  aria-label={isPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'}
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
              />

              <button
                className="registerPasswordToggle"
                type="button"
                aria-label={isRepeatPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                onClick={() => setIsRepeatPasswordVisible((value) => !value)}
              >
                <EyeSlashIcon />
              </button>
            </div>
          </label>

          <div className="registerAgreementBlock">
            <p>Нажимая Зарегистрироваться. Вы соглашаетесь</p>

            <p>
              с{' '}
              <a href="#terms">Условиями</a>
              {' '}и{' '}
              <a href="#privacy">Политикой конфиденциальности</a>
            </p>
          </div>

          <button className="registerSubmitButton" type="submit">
            Зарегистрироваться
          </button>

          <div className="registerLoginLink">
            <span>Есть аккаунт?</span>

            <button type="button" onClick={onOpenLogin}>
              Войти
            </button>
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