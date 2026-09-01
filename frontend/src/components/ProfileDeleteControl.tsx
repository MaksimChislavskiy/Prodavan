import { useState, type MouseEvent } from 'react'

import { deleteProfile } from '../shared/api/profileApi'
import { clearAccessToken } from '../shared/api/authToken'

type ProfileDeleteControlProps = {
  version: number
  disabled?: boolean
}

export function ProfileDeleteControl({
  version,
  disabled = false,
}: ProfileDeleteControlProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')

  const close = () => {
    if (!isDeleting) {
      setIsOpen(false)
    }
  }

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      close()
    }
  }

  const handleDelete = async () => {
    if (isDeleting) {
      return
    }

    setIsDeleting(true)
    setError('')

    try {
      await deleteProfile(version)
      clearAccessToken()
      window.localStorage.clear()
      window.sessionStorage.clear()
      window.location.replace('/login?account_deleted=1')
    } catch {
      setError('Не удалось удалить аккаунт. Попробуйте позже.')
      setIsDeleting(false)
    }
  }

  return (
    <>
      <button
        className="profile-form__delete-account"
        type="button"
        disabled={disabled || isDeleting}
        onClick={() => {
          setError('')
          setIsOpen(true)
        }}
      >
        Удалить аккаунт
      </button>

      {isOpen && (
        <div
          className="profile-avatar-modal__backdrop"
          role="presentation"
          onMouseDown={handleBackdropMouseDown}
        >
          <section
            className="profile-avatar-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="profile-delete-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2
              className="profile-avatar-modal__title"
              id="profile-delete-modal-title"
            >
              Удалить аккаунт
            </h2>
            <p className="profile-avatar-modal__text">
              Вы уверены, что хотите удалить аккаунт? Это действие невозможно отменить. Все ваши данные будут анонимизированы в соответствии с политикой хранения.
            </p>

            {error && (
              <p className="profile-avatar-modal__error" role="alert">
                {error}
              </p>
            )}

            <div className="profile-avatar-modal__actions">
              <button
                className="profile-avatar-modal__button profile-avatar-modal__button--secondary"
                type="button"
                disabled={isDeleting}
                onClick={close}
              >
                Отмена
              </button>
              <button
                className="profile-avatar-modal__button profile-avatar-modal__button--primary"
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDelete()}
              >
                {isDeleting ? 'Удаление...' : 'Удалить аккаунт'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
