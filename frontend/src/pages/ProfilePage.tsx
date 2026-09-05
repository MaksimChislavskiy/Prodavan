import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { ProfileDeleteControl } from '../components/ProfileDeleteControl'
import { ApiError } from '../shared/api/apiClient'
import {
  deleteProfileAvatar,
  getProfile,
  updateProfile,
  uploadProfileAvatar,
  type ApiProfile,
} from '../shared/api/profileApi'
import { notifyProfileUpdated } from '../shared/profileEvents'
import './ProfilePage.css'

type ProfileForm = {
  name: string
  position: string
  phone: string
  email: string
}

type ProfileErrors = Partial<Record<keyof ProfileForm, string>>

type AvatarPreview = {
  file: File
  url: string
}

type PendingNavigation =
  | { type: 'back' }
  | { type: 'url'; href: string }

const PROFILE_TEXT_PATTERN = /^[A-Za-zА-Яа-яЁё -]+$/
const PHONE_PATTERN = /^[0-9+()\- ]+$/
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_AVATAR_SIZE = 5 * 1024 * 1024
const MIN_AVATAR_SIDE = 200
const PROFILE_VERSION_CONFLICT_MESSAGE =
  'Данные профиля были изменены другим процессом. Обновите страницу и повторите попытку.'

export function ProfilePage() {
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const allowNavigationRef = useRef(false)
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
  const [isAvatarUploading, setIsAvatarUploading] = useState(false)
  const [isAvatarDeleting, setIsAvatarDeleting] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<AvatarPreview | null>(null)
  const [avatarError, setAvatarError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)

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
        notifyProfileUpdated(data)
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

  useEffect(() => {
    return () => {
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview.url)
      }
    }
  }, [avatarPreview])

  const errors = useMemo(() => validateProfileForm(form), [form])
  const isChanged = initialForm !== null && !areFormsEqual(form, initialForm)
  const hasErrors = Object.keys(errors).length > 0
  const isAvatarBusy = isAvatarUploading || isAvatarDeleting
  const canSave = Boolean(profile && isChanged && !hasErrors && !isSaving && !isAvatarBusy)
  const hasUnsavedChanges = isChanged || avatarPreview !== null

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges || allowNavigationRef.current) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [hasUnsavedChanges])

  useEffect(() => {
    const handleInternalLink = (event: MouseEvent) => {
      if (
        !hasUnsavedChanges
        || allowNavigationRef.current
        || event.button !== 0
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || event.altKey
      ) {
        return
      }

      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      const link = target.closest<HTMLAnchorElement>('a[href]')
      if (
        !link
        || link.target === '_blank'
        || link.hasAttribute('download')
      ) {
        return
      }

      const url = new URL(link.href, window.location.href)
      if (
        url.origin !== window.location.origin
        || url.href === window.location.href
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setPendingNavigation({ type: 'url', href: url.href })
    }

    document.addEventListener('click', handleInternalLink, true)
    return () => document.removeEventListener('click', handleInternalLink, true)
  }, [hasUnsavedChanges])

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

  const navigateBack = () => {
    if (window.history.length > 1) {
      window.history.back()
      return
    }

    window.location.href = '/app'
  }

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setPendingNavigation({ type: 'back' })
      return
    }

    navigateBack()
  }

  const leaveWithUnsavedChanges = () => {
    if (!pendingNavigation) {
      return
    }

    const navigation = pendingNavigation
    allowNavigationRef.current = true
    setPendingNavigation(null)

    if (navigation.type === 'back') {
      navigateBack()
      return
    }

    window.location.href = navigation.href
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
      notifyProfileUpdated(updatedProfile)
    } catch (error) {
      setSaveError(
        isProfileVersionConflict(error)
          ? PROFILE_VERSION_CONFLICT_MESSAGE
          : error instanceof Error
            ? error.message
            : 'Не удалось сохранить изменения. Попробуйте позже.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleAvatarSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || isAvatarBusy) {
      return
    }

    setAvatarError('')
    setSuccessMessage('')

    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      setAvatarError('Допустимы только изображения JPG, PNG или WEBP.')
      return
    }

    if (file.size > MAX_AVATAR_SIZE) {
      setAvatarError('Размер файла не должен превышать 5 МБ.')
      return
    }

    const previewUrl = URL.createObjectURL(file)

    try {
      const dimensions = await getImageDimensions(previewUrl)

      if (dimensions.width < MIN_AVATAR_SIDE || dimensions.height < MIN_AVATAR_SIDE) {
        URL.revokeObjectURL(previewUrl)
        setAvatarError('Изображение слишком маленькое. Минимум 200×200 пикселей.')
        return
      }

      setAvatarPreview({ file, url: previewUrl })
    } catch {
      URL.revokeObjectURL(previewUrl)
      setAvatarError('Недопустимый формат файла или файл повреждён.')
    }
  }

  const closeAvatarPreview = () => {
    if (isAvatarUploading) {
      return
    }

    setAvatarPreview(null)
  }

  const handleAvatarUpload = async () => {
    if (!avatarPreview || isAvatarBusy) {
      return
    }

    setIsAvatarUploading(true)
    setAvatarError('')
    setSuccessMessage('')

    try {
      const updatedProfile = await uploadProfileAvatar(avatarPreview.file)
      setProfile(updatedProfile)
      setAvatarPreview(null)
      setSuccessMessage('Аватар успешно обновлён')
      notifyProfileUpdated(updatedProfile)
    } catch (error) {
      setAvatarError(
        error instanceof Error ? error.message : 'Не удалось загрузить изображение. Попробуйте позже.',
      )
    } finally {
      setIsAvatarUploading(false)
    }
  }

  const handleAvatarDelete = async () => {
    if (!profile || isAvatarBusy || !(profile.avatar || profile.avatar_medium || profile.avatar_small)) {
      return
    }

    const isConfirmed = window.confirm(
      'Вы уверены, что хотите удалить аватар? Будет установлено изображение по умолчанию.',
    )

    if (!isConfirmed) {
      return
    }

    setIsAvatarDeleting(true)
    setAvatarError('')
    setSuccessMessage('')

    try {
      await deleteProfileAvatar()
      const updatedProfile = await getProfile()
      setProfile(updatedProfile)
      setSuccessMessage('Аватар удалён')
      notifyProfileUpdated(updatedProfile)
    } catch (error) {
      setAvatarError(
        error instanceof Error ? error.message : 'Не удалось удалить аватар. Попробуйте позже.',
      )
    } finally {
      setIsAvatarDeleting(false)
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
  const hasAvatar = Boolean(profile.avatar || profile.avatar_medium || profile.avatar_small)

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

          <input
            className="profile-avatar-input"
            ref={avatarInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={(event) => void handleAvatarSelect(event)}
          />

          <div className="profile-avatar-actions">
            <button
              type="button"
              aria-label="Удалить аватар"
              title={hasAvatar ? 'Удалить аватар' : 'Аватар не загружен'}
              disabled={!hasAvatar || isAvatarBusy}
              onClick={() => void handleAvatarDelete()}
            >
              <TrashIcon />
            </button>
            <button
              type="button"
              aria-label="Изменить аватар"
              title="Загрузить или заменить аватар"
              disabled={isAvatarBusy}
              onClick={() => avatarInputRef.current?.click()}
            >
              <EditIcon />
            </button>
          </div>

          {isAvatarBusy && (
            <span className="profile-avatar-status">
              {isAvatarDeleting ? 'Удаление...' : 'Загрузка...'}
            </span>
          )}

          {avatarError && (
            <p className="profile-avatar-error" role="alert">
              {avatarError}
            </p>
          )}
        </aside>

        <form className="profile-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className="profile-form__fields">
            <h1 className="profile-form__title">Основные данные</h1>

            <ProfileField
              label="Имя"
              value={form.name}
              placeholder="Введите имя"
              disabled={isSaving || isAvatarBusy}
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
              disabled={isSaving || isAvatarBusy}
              error={errors.position}
              onChange={(value) => updateField('position', value)}
            />

            <ProfileField
              label="Телефон"
              value={form.phone}
              placeholder="Введите телефон"
              disabled={isSaving || isAvatarBusy}
              error={errors.phone}
              onChange={(value) => updateField('phone', value)}
            />

            <ProfileField
              label="E-mail"
              value={form.email}
              type="email"
              placeholder="Введите email"
              disabled={isSaving || isAvatarBusy}
              error={errors.email}
              onChange={(value) => updateField('email', value)}
            />

            <ProfileDeleteControl
              version={profile.version}
              disabled={isSaving || isAvatarBusy}
            />
          </div>

          {saveError && <p className="profile-form__save-error" role="alert">{saveError}</p>}

          <button className="profile-form__save" type="submit" disabled={!canSave}>
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
      </div>

      {avatarPreview && (
        <div className="profile-avatar-modal__backdrop" role="presentation" onMouseDown={closeAvatarPreview}>
          <section
            className="profile-avatar-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-avatar-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 className="profile-avatar-modal__title" id="profile-avatar-modal-title">
              Новый аватар
            </h2>
            <p className="profile-avatar-modal__text">
              Проверьте изображение перед сохранением.
            </p>
            <div className="profile-avatar-modal__preview">
              <img src={avatarPreview.url} alt="Предпросмотр нового аватара" />
            </div>

            {avatarError && (
              <p className="profile-avatar-modal__error" role="alert">
                {avatarError}
              </p>
            )}

            <div className="profile-avatar-modal__actions">
              <button
                className="profile-avatar-modal__button profile-avatar-modal__button--secondary"
                type="button"
                disabled={isAvatarUploading}
                onClick={closeAvatarPreview}
              >
                Отмена
              </button>
              <button
                className="profile-avatar-modal__button profile-avatar-modal__button--primary"
                type="button"
                disabled={isAvatarUploading}
                onClick={() => void handleAvatarUpload()}
              >
                {isAvatarUploading ? 'Загрузка...' : 'Сохранить'}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingNavigation && (
        <div
          className="profile-avatar-modal__backdrop"
          role="presentation"
          onMouseDown={() => setPendingNavigation(null)}
        >
          <section
            className="profile-avatar-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="profile-unsaved-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 className="profile-avatar-modal__title" id="profile-unsaved-modal-title">
              Несохранённые изменения
            </h2>
            <p className="profile-avatar-modal__text">
              У вас есть несохранённые изменения. Покинуть страницу без сохранения?
            </p>
            <div className="profile-avatar-modal__actions">
              <button
                className="profile-avatar-modal__button profile-avatar-modal__button--secondary"
                type="button"
                onClick={() => setPendingNavigation(null)}
              >
                Остаться
              </button>
              <button
                className="profile-avatar-modal__button profile-avatar-modal__button--primary"
                type="button"
                onClick={leaveWithUnsavedChanges}
              >
                Покинуть страницу
              </button>
            </div>
          </section>
        </div>
      )}

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

function isProfileVersionConflict(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return false
  }

  if (!error.data || typeof error.data !== 'object') {
    return false
  }

  return 'error' in error.data && error.data.error === 'version_conflict'
}

function getImageDimensions(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = reject
    image.src = url
  })
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
