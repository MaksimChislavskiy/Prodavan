import type { ApiContact, UpdateContactRequest } from '../../shared/api/contactsApi'

export type ContactDraft = {
  name: string
  company: string
  phone: string
  email: string
  telegram: string
  comment: string
}

export type ContactField = keyof ContactDraft
export type ContactErrors = Partial<Record<ContactField, string>>

export type NormalizedContactDraft = {
  name: string
  company: string | null
  phone: string | null
  email: string | null
  telegram: string | null
  comment: string | null
}

export const EMPTY_CONTACT_DRAFT: ContactDraft = {
  name: '',
  company: '',
  phone: '',
  email: '',
  telegram: '',
  comment: '',
}

export const CONTACT_FIELD_LABELS: Record<ContactField, string> = {
  name: 'ФИО',
  company: 'Компания',
  phone: 'Рабочий телефон',
  email: 'E-mail',
  telegram: 'Telegram',
  comment: 'Комментарий',
}

export const CONTACT_PLACEHOLDERS: Record<ContactField, string> = {
  name: 'Введите ФИО',
  company: 'Введите название',
  phone: 'Введите номер',
  email: 'Введите email',
  telegram: 'Введите никнейм',
  comment: 'Написать...',
}

export function normalizeContactDraft(draft: ContactDraft): {
  values: NormalizedContactDraft
  errors: ContactErrors
} {
  const errors: ContactErrors = {}
  const name = draft.name.trim()
  const company = normalizeNullableText(draft.company)
  const email = normalizeNullableText(draft.email)?.toLowerCase() ?? null
  const comment = normalizeNullableText(draft.comment)
  let phone = normalizeNullableText(draft.phone)
  let telegram = normalizeNullableText(draft.telegram)

  if (!name) {
    errors.name = 'Заполните поле.'
  } else if (name.length > 100) {
    errors.name = 'ФИО должно содержать не больше 100 символов.'
  } else if (!/^[A-Za-zА-Яа-яЁё -]+$/.test(name)) {
    errors.name = 'Допустимы только буквы, пробелы и дефисы.'
  }

  if (company && company.length > 100) {
    errors.company = 'Название компании должно содержать не больше 100 символов.'
  }

  if (phone) {
    phone = phone.replace(/[\s()-]/g, '')

    if (phone.startsWith('+')) {
      const digits = phone.slice(1)
      if (!/^\d{7,15}$/.test(digits)) {
        errors.phone = 'Введите номер, содержащий от 7 до 15 цифр.'
      }
    } else if (/^\d{11}$/.test(phone) && phone.startsWith('8')) {
      phone = `+7${phone.slice(1)}`
    } else if (/^\d{10}$/.test(phone)) {
      phone = `+7${phone}`
    } else if (!/^\d{7,15}$/.test(phone)) {
      errors.phone = 'Введите корректный номер телефона.'
    }
  }

  if (email) {
    if (email.length > 255) {
      errors.email = 'E-mail должен содержать не больше 255 символов.'
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.email = 'Введите корректный e-mail.'
    }
  }

  if (telegram) {
    const username = telegram.replace(/^@+/, '')
    if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
      errors.telegram = 'Введите 5–32 латинских символа, цифры или _.'
    }
    telegram = `@${username}`
  }

  if (comment && comment.length > 500) {
    errors.comment = 'Комментарий должен содержать не больше 500 символов.'
  }

  return {
    values: {
      name,
      company,
      phone,
      email,
      telegram,
      comment,
    },
    errors,
  }
}

export function getContactChanges(
  initialValues: NormalizedContactDraft,
  currentValues: NormalizedContactDraft,
) {
  const changes: Omit<UpdateContactRequest, 'version'> = {}

  for (const field of Object.keys(currentValues) as ContactField[]) {
    if (currentValues[field] !== initialValues[field]) {
      Object.assign(changes, { [field]: currentValues[field] })
    }
  }

  return changes
}

export function contactToDraft(contact: ApiContact): ContactDraft {
  return {
    name: contact.name,
    company: contact.company ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    telegram: contact.telegram ?? '',
    comment: contact.comment ?? '',
  }
}

export function serializeNormalizedDraft(draft: NormalizedContactDraft) {
  return JSON.stringify(draft)
}

export function getVisibleError(
  field: ContactField,
  touchedFields: Set<ContactField>,
  errors: ContactErrors,
) {
  return touchedFields.has(field) ? errors[field] : undefined
}

export function hasRawContactInput(draft: ContactDraft) {
  return Object.values(draft).some((value) => value.length > 0)
}

function normalizeNullableText(value: string) {
  const normalizedValue = value.trim()
  return normalizedValue || null
}
