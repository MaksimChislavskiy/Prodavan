import { useEffect, useRef, useState } from 'react'
import { clearAccessToken } from '../../shared/api/authToken'
import { deleteProfile, getProfile } from '../../shared/api/profileApi'
import './AccountDeleteController.css'

const DELETE_BUTTON_SELECTOR = '.profile-form__delete-account'

export function AccountDeleteController() {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const enableDeleteButton = () => {
      const button = document.querySelector<HTMLButtonElement>(DELETE_BUTTON_SELECTOR)

      if (!button) {
        return
      }

      button.disabled = false
      button.removeAttribute('title')
      button.setAttribute('aria-haspopup', 'dialog')
    }

    enableDeleteButton()

    const observer = new MutationObserver(enableDeleteButton)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    })

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      const button = target.closest<HTMLButtonElement>(DELETE_BUTTON_SELECTOR)

      if (!button || button.disabled) {
        return
      }

      event.preventDefault()
      setErrorMessage('')
      setIsOpen(true)
    }

    document.addEventListener('click', handleDocumentClick)

    return () => {
      observer.disconnect()
      document.removeEventListener('click', handleDocumentClick)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    cancelButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) {
        setIsOpen(false)
        setErrorMessage('')
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isDeleting, isOpen])

  const closeModal = () => {
    if (isDeleting) {
      return
    }

    setIsOpen(false)
    setErrorMessage('')
  }

  const handleDeleteAccount = async () => {
    if (isDeleting) {
      return
    }

    setIsDeleting(true)
    setErrorMessage('')

    try {
      const profile = await getProfile()
      await deleteProfile(profile.version)

      clearAccessToken()
      localStorage.clear()
      sessionStorage.clear()
      sessionStorage.setItem('account_deleted_message', 'Ваша учётная запись удалена')
      window.location.href = '/?account_deleted=1'
    } catch {
      setErrorMessage('Не удалось удалить аккаунт. Попробуйте позже.')
      setIsDeleting(false)
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className="account-delete-modal__backdrop" role="presentation" onMouseDown={closeModal}>
      <section
        className="account-delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-delete-modal-title"
        aria-describedby="account-delete-modal-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="account-delete-modal__title" id="account-delete-modal-title">
          Удалить аккаунт?
        </h2>

        <p className="account-delete-modal__text" id="account-delete-modal-description">
          Вы уверены, что хотите удалить аккаунт? Это действие невозможно отменить. Все ваши
          данные будут анонимизированы в соответствии с политикой хранения.
        </p>

        {errorMessage && (
          <p className="account-delete-modal__error" role="alert">
            {errorMessage}
          </p>
        )}

        <div className="account-delete-modal__actions">
          <button
            className="account-delete-modal__button account-delete-modal__button--secondary"
            ref={cancelButtonRef}
            type="button"
            disabled={isDeleting}
            onClick={closeModal}
          >
            Отмена
          </button>
          <button
            className="account-delete-modal__button account-delete-modal__button--danger"
            type="button"
            disabled={isDeleting}
            onClick={() => void handleDeleteAccount()}
          >
            {isDeleting ? 'Удаляем...' : 'Удалить аккаунт'}
          </button>
        </div>
      </section>
    </div>
  )
}
