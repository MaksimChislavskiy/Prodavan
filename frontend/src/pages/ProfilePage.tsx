import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  getProfile,
  updateProfile,
  type ApiProfile,
} from '../shared/api/profileApi'
import './ProfilePage.css'

type ProfileForm = {
  name: string
  position: string
  phone: string
  email: string
}

type ProfileErrors = Partial<Record<keyof ProfileForm, string>>

const PROFILE_TEXT_PATTERN = /^[A-Za-zА-Яа-яЁё -]+$/
const PHONE_PATTERN = /^[0-9+()\- ]+$/

export function ProfilePage() {
  const [profile, setProfile] = useState<ApiProfile | null>(null)
  const [initialForm, setInitialForm] = useState<ProfileForm | null>(null)
  const [form, setForm] = useState<ProfileForm>({
    name: '',
    position: '',
    phone: '',
    email: '',
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadProfile() {
      setIsLoading(true)
      setLoadError('')

      try {
        const data = await getProfile()

        if (!isMounted) {
          return
        }

        const nextForm = profileToForm(data)
        setProfile(data)
        setInitialForm(nextForm)
        setForm(nextForm)
      } catch (error) {
        if (!isMounted) {
          return
        }

        setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить профиль.')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadProfile()

    return () => {
      isMounted = false
    }
  }, [])

  const errors = useMemo(() => validateProfileForm(form), [form])
  const isChanged = initialForm !== null && !areFormsEqual(form, initialForm)
  const hasErrors = Object.keys(errors).length > 0
  const canSave = Boolean(profile && isChanged && !hasErrors && !isSaving)

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isChanged) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [isChanged])

  useEffect(() => {
    if (!successMessage) {
      return
    }

    const timerId = window.setTimeout(() => setSuccessMessage(''), 3000)
    return () => window.clearTimeout(timerId)
  }, [successMessage])

  const updateField = (field: keyof ProfileForm, value: string) => {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
    setSaveError('')
    setSuccessMessage('')
  }

  const handleBack = () => {
    if (isChanged && !window.confirm('У вас есть несохранённые изменения. Покинуть страницу без сохранения?')) {
      return
    }

    if (window.history.length > 1) {
      window.history.back()
      return
    }

    window.location.href = '/app'
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!profile || !canSave) {
      return
    }

    setIsSaving(true)
    setSaveError('')
    setSuccessMessage('')

    try {
      const updatedProfile = await updateProfile({
        version: profile.version,
        name: form.name.trim(),
        position: form.position.trim(),
        phone: form.phone.trim(),
        email: form.email.trim().toLowerCase(),
      })
      const nextForm = profileToForm(updatedProfile)

      setProfile(updatedProfile)
      setInitialForm(nextForm)
      setForm(nextForm)
      setSuccessMessage('Изменения успешно сохранены')
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Не удалось сохранить изменения. Попробуйте позже.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <section className="profile-page profile-page--loading" aria-busy="true">
        <div className="profile-page__loading-card">Загружаем профиль...</div>
      </section>
    )
  }

  if (loadError || !profile) {
    return (
      <section className="profile-page">
        <div className="profile-page__loading-card profile-page__loading-card--error">
          <p>{loadError || 'Не удалось загрузить профиль.'}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Повторить
          </button>
        </div>
      </section>
    )
  }

  const avatarUrl = profile.avatar_medium || profile.avatar

  return (
    <section className="profile-page" aria-label="Профиль пользователя">
      <button className="profile-page__back" type="button" aria-label="Вернуться назад" onClick={handleBack}>
        ←
      </button>

      <div className="profile-page__layout">
        <aside className="profile-avatar-panel" aria-label="Аватар пользователя">
          <div className="profile-avatar">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Аватар пользователя" />
            ) : (
              <DefaultAvatarIcon />
            )}
          </div>

          <div className="profile-avatar-actions">
            <button type="button" aria-label="Удалить аватар" title="Подключим следующим этапом" disabled>
              <TrashIcon />
            </button>
            <button type="button" aria-label="Изменить аватар" title="Подключим следующим этапом" disabled>
              <EditIcon />
            </button>
          </div>
        </aside>

        <form className="profile-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className="profile-form__fields">
            <h1 className="profile-form__title">Основные данные</h1>

            <ProfileField
              label="Имя"
              value={form.name}
              placeholder="Введите имя"
              disabled={isSaving}
              error={errors.name}
              onChange={(value) => updateField('name', value)}
            />

            <ProfileField
              label="ID"
              value={profile.id}
              disabled
              muted
              onChange={() => undefined}
            />

            <ProfileField
              label="Должность"
              value={form.position}
              placeholder="Введите должность"
              disabled={isSaving}
              error={errors.position}
              onChange={(value) => updateField('position', value)}
            />

            <ProfileField
              label="Телефон"
              value={form.phone}
              placeholder="Введите телефон"
              disabled={isSaving}
              error={errors.phone}
              onChange={(value) => updateField('phone', value)}
            />

            <ProfileField
              label="E-mail"
              value={form.email}
              type="email"
              placeholder="Введите e-mail"
              disabled={isSaving}
              error={errors.email}
              onChange={(value) => updateField('email', value)}
            />

            <button
              className="profile-form__delete-account"
              type="button"
              title="Удаление аккаунта подключим отдельным этапом"
              disabled
            >
              Удалить аккаунт
            </button>
          </div>

          {saveError && <p className="profile-form__save-error" role="alert">{saveError}</p>}

          <button className="profile-form__save" type="submit" disabled={!canSave}>
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
      </div>

      {successMessage && (
        <div className="profile-toast" role="status">
          {successMessage}
        </div>
      )}
    </section>
  )
}

type ProfileFieldProps = {
  label: string
  value: string
  placeholder?: string
  type?: 'text' | 'email'
  disabled?: boolean
  muted?: boolean
  error?: string
  onChange: (value: string) => void
}

function ProfileField({
  label,
  value,
  placeholder,
  type = 'text',
  disabled = false,
  muted = false,
  error,
  onChange,
}: ProfileFieldProps) {
  const inputId = `profile-${label.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-')}`

  return (
    <div className="profile-field-wrapper">
      <div className="profile-field">
        <label className="profile-field__label" htmlFor={inputId}>{label}</label>
        <input
          className={muted ? 'profile-field__input profile-field__input--muted' : 'profile-field__input'}
          id={inputId}
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {error && <p className="profile-field__error" id={`${inputId}-error`}>{error}</p>}
    </div>
  )
}

function profileToForm(profile: ApiProfile): ProfileForm {
  return {
    name: profile.name ?? '',
    position: profile.position ?? '',
    phone: profile.phone ?? '',
    email: profile.email ?? '',
  }
}

function areFormsEqual(first: ProfileForm, second: ProfileForm) {
  return (
    first.name === second.name &&
    first.position === second.position &&
    first.phone === second.phone &&
    first.email === second.email
  )
}

function validateProfileForm(form: ProfileForm): ProfileErrors {
  const errors: ProfileErrors = {}
  const name = form.name.trim()
  const position = form.position.trim()
  const phone = form.phone.trim()
  const email = form.email.trim()

  if (!name) {
    errors.name = 'Заполните поле.'
  } else if (name.length < 2 || name.length > 100) {
    errors.name = 'Имя должно содержать от 2 до 100 символов.'
  } else if (!PROFILE_TEXT_PATTERN.test(name)) {
    errors.name = 'Допустимы только буквы, пробел и дефис.'
  }

  if (position.length > 100) {
    errors.position = 'Должность должна содержать не больше 100 символов.'
  } else if (position && !PROFILE_TEXT_PATTERN.test(position)) {
    errors.position = 'Допустимы только буквы, пробел и дефис.'
  }

  if (phone.length > 20) {
    errors.phone = 'Телефон должен содержать не больше 20 символов.'
  } else if (phone && !PHONE_PATTERN.test(phone)) {
    errors.phone = 'Укажите корректный номер телефона.'
  } else if (phone && [...phone].filter((character) => /\d/.test(character)).length < 5) {
    errors.phone = 'Телефон должен содержать минимум 5 цифр.'
  }

  if (!email) {
    errors.email = 'Заполните поле.'
  } else if (!/^\S+@\S+\.\S+$/.test(email)) {
    errors.email = 'Укажите корректный e-mail.'
  } else if (email.length > 255) {
    errors.email = 'E-mail должен содержать не больше 255 символов.'
  }

  return errors
}

function DefaultAvatarIcon() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="profile-avatar-background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0b2b55" />
          <stop offset="1" stopColor="#50c4d3" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill="url(#profile-avatar-background)" />
      <circle cx="50" cy="37" r="19" fill="#dbeeff" />
      <path d="M17 91c5-22 18-33 33-33s28 11 33 33" fill="#dbeeff" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 10v7m4-7v7" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 20 4.2-1 10-10-3.2-3.2-10 10L4 20Zm9.8-13 3.2 3.2" />
    </svg>
  )
}
