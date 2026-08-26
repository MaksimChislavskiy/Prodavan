import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from 'react'
import { ApiError } from '../../shared/api/apiClient'
import { getContacts, type ApiContact } from '../../shared/api/contactsApi'
import {
  getDealsPage,
  getKanban,
  type ApiKanbanDeal,
} from '../../shared/api/dealsApi'
import {
  createTask,
  createTaskIdempotencyKey,
  deleteTask,
  getTask,
  updateTask,
  updateTaskStatus,
  type ApiTaskDetail,
  type CreateTaskRequest,
  type TaskDueDateType,
  type TaskStatus,
  type UpdateTaskRequest,
} from '../../shared/api/tasksApi'
import './TaskFormModal.css'
import './TaskFormModalTzFixes.css'

type TaskFormMode = 'create' | 'edit'

type TaskDraft = {
  title: string
  dueDateType: TaskDueDateType
  dueDate: string
  description: string
  contactId: string
  dealId: string
  comment: string
  status: TaskStatus
}

type TaskFormModalProps = {
  mode: TaskFormMode
  taskId?: string
  taskTitle?: string
  onClose: () => void
  onCreated: () => void
  onUpdated: () => void
  onDeleted: () => void
  onNotFound: () => void
}

const emptyTaskDraft: TaskDraft = {
  title: '',
  dueDateType: 'none',
  dueDate: '',
  description: '',
  contactId: '',
  dealId: '',
  comment: '',
  status: 'new',
}

export function TaskFormModal({
  mode,
  taskId,
  taskTitle,
  onClose,
  onCreated,
  onUpdated,
  onDeleted,
  onNotFound,
}: TaskFormModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const idempotencyRef = useRef({
    key: createTaskIdempotencyKey(),
    payload: '',
  })
  const [draft, setDraft] = useState<TaskDraft>(emptyTaskDraft)
  const [contacts, setContacts] = useState<ApiContact[]>([])
  const [deals, setDeals] = useState<ApiKanbanDeal[]>([])
  const [version, setVersion] = useState<number | null>(
    mode === 'create' ? 0 : null,
  )
  const [initialDraft, setInitialDraft] = useState('')
  const [initialFields, setInitialFields] = useState('')
  const [initialStatus, setInitialStatus] = useState<TaskStatus>('new')
  const [isLoading, setIsLoading] = useState(true)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [isConflictConfirmOpen, setIsConflictConfirmOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)

  const filteredDeals = useMemo(() => {
    if (draft.contactId) {
      return deals.filter((deal) => deal.contact?.id === draft.contactId)
    }
    if (draft.dealId) {
      return deals.filter((deal) => deal.id === draft.dealId)
    }
    return []
  }, [deals, draft.contactId, draft.dealId])

  const selectedDeal = useMemo(
    () => deals.find((deal) => deal.id === draft.dealId) ?? null,
    [deals, draft.dealId],
  )

  const serializedDraft = serializeTaskDraft(draft)
  const isDirty = initialDraft !== '' && serializedDraft !== initialDraft
  const fieldsChanged =
    initialFields !== '' && serializeTaskFields(draft) !== initialFields
  const statusChanged = mode === 'edit' && draft.status !== initialStatus
  const validation = validateTaskDraft(draft)
  const canSubmit =
    validation.isValid &&
    !isLoading &&
    !isSaving &&
    !isDeleting &&
    (mode === 'create' || isDirty)

  const stopCurrentRequest = useCallback(() => {
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
  }, [])

  const loadForm = useCallback(async () => {
    stopCurrentRequest()
    const controller = new AbortController()
    requestControllerRef.current = controller
    setIsLoading(true)
    setIsInitialized(false)
    setRequestError('')

    try {
      const choicesPromise = loadTaskChoices(controller.signal)
      const taskPromise =
        mode === 'edit' && taskId
          ? getTask(taskId, controller.signal)
          : Promise.resolve(null)
      const [choices, task] = await Promise.all([choicesPromise, taskPromise])

      setContacts(choices.contacts)
      setDeals(choices.deals)

      const nextDraft = task ? taskToDraft(task) : emptyTaskDraft
      setDraft(nextDraft)
      setInitialDraft(serializeTaskDraft(nextDraft))
      setInitialFields(serializeTaskFields(nextDraft))
      setInitialStatus(nextDraft.status)
      setVersion(task?.version ?? 0)
      setIsInitialized(true)
      window.setTimeout(() => titleInputRef.current?.focus(), 0)
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      if (
        mode === 'edit' &&
        error instanceof ApiError &&
        error.status === 404
      ) {
        onNotFound()
        return
      }

      setRequestError(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить данные задачи.',
      )
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
      }
      setIsLoading(false)
    }
  }, [mode, onNotFound, stopCurrentRequest, taskId])

  const requestClose = useCallback(() => {
    if (isSaving || isDeleting) {
      return
    }
    if (isDirty) {
      setIsCloseConfirmOpen(true)
    } else {
      onClose()
    }
  }, [isDeleting, isDirty, isSaving, onClose])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const setupTimeoutId = window.setTimeout(() => {
      void loadForm()
    }, 0)

    return () => {
      document.body.style.overflow = originalOverflow
      window.clearTimeout(setupTimeoutId)
      stopCurrentRequest()
    }
  }, [loadForm, stopCurrentRequest])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        isCloseConfirmOpen ||
        isConflictConfirmOpen ||
        isDeleteConfirmOpen
      ) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }

      if (event.key !== 'Tab' || !modalRef.current) {
        return
      }

      const focusableElements = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ),
      )
      if (focusableElements.length === 0) {
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    isCloseConfirmOpen,
    isConflictConfirmOpen,
    isDeleteConfirmOpen,
    requestClose,
  ])

  const updateField =
    (field: keyof TaskDraft) =>
    (
      event: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const value = event.target.value
      setDraft((currentDraft) => ({
        ...currentDraft,
        [field]: value,
      }))
      setRequestError('')
    }

  const updateDueDateType = (event: ChangeEvent<HTMLSelectElement>) => {
    const dueDateType = event.target.value as TaskDueDateType
    setDraft((currentDraft) => ({
      ...currentDraft,
      dueDateType,
      dueDate:
        dueDateType === 'none' || currentDraft.dueDateType !== dueDateType
          ? ''
          : currentDraft.dueDate,
    }))
    setRequestError('')
  }

  const updateDueDate = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      dueDate: event.target.value,
    }))
    setRequestError('')
  }

  const updateContact = (event: ChangeEvent<HTMLSelectElement>) => {
    const contactId = event.target.value
    setDraft((currentDraft) => {
      const selectedTaskDeal = deals.find(
        (deal) => deal.id === currentDraft.dealId,
      )
      const canKeepDeal =
        selectedTaskDeal &&
        (!contactId || selectedTaskDeal.contact?.id === contactId)

      return {
        ...currentDraft,
        contactId,
        dealId: canKeepDeal ? currentDraft.dealId : '',
      }
    })
    setRequestError('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    if (mode === 'edit' && (!taskId || version === null)) {
      setRequestError('Не удалось определить версию задачи. Обновите данные.')
      return
    }

    stopCurrentRequest()
    const controller = new AbortController()
    requestControllerRef.current = controller
    setIsSaving(true)
    setRequestError('')

    try {
      const payload = buildTaskPayload(draft)

      if (mode === 'create') {
        const serializedPayload = JSON.stringify(payload)
        if (idempotencyRef.current.payload !== serializedPayload) {
          idempotencyRef.current = {
            key: createTaskIdempotencyKey(),
            payload: serializedPayload,
          }
        }

        await createTask(
          payload,
          idempotencyRef.current.key,
          controller.signal,
        )
        onCreated()
        return
      }

      let currentVersion = version as number
      if (fieldsChanged) {
        const request: UpdateTaskRequest = {
          version: currentVersion,
          ...payload,
        }
        const updatedTask = await updateTask(
          taskId as string,
          request,
          controller.signal,
        )
        currentVersion = updatedTask.version
      }

      if (statusChanged) {
        const updatedTask = await updateTaskStatus(
          taskId as string,
          draft.status,
          currentVersion,
          controller.signal,
        )
        currentVersion = updatedTask.version
      }

      setVersion(currentVersion)
      onUpdated()
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      if (
        mode === 'edit' &&
        error instanceof ApiError &&
        error.status === 409
      ) {
        setIsConflictConfirmOpen(true)
      } else if (
        mode === 'edit' &&
        error instanceof ApiError &&
        error.status === 404
      ) {
        onNotFound()
      } else {
        setRequestError(
          mode === 'edit'
            ? 'Не удалось сохранить изменения. Попробуйте позже.'
            : error instanceof Error
              ? error.message
              : 'Не удалось создать задачу.',
        )
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
      }
      setIsSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (mode !== 'edit' || !taskId || isDeleting) {
      return
    }

    stopCurrentRequest()
    const controller = new AbortController()
    requestControllerRef.current = controller
    setIsDeleting(true)
    setRequestError('')

    try {
      await deleteTask(taskId, controller.signal)
      onDeleted()
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      if (error instanceof ApiError && error.status === 404) {
        onNotFound()
      } else {
        setIsDeleteConfirmOpen(false)
        setRequestError('Не удалось удалить задачу. Попробуйте позже.')
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
      }
      setIsDeleting(false)
    }
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      requestClose()
    }
  }

  const isReady =
    !isLoading &&
    isInitialized &&
    (mode === 'create' || version !== null)

  return (
    <div
      className="task-form-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className={`task-form-modal task-form-modal--${mode}`}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-form-title"
        aria-busy={isLoading || isSaving || isDeleting}
      >
        <header className="task-form-modal__header">
          <h2 id="task-form-title">
            {mode === 'create' ? 'Создание задачи' : 'Редактирование задачи'}
          </h2>
          <button
            className="task-form-modal__close"
            type="button"
            aria-label="Закрыть"
            disabled={isSaving || isDeleting}
            onClick={requestClose}
          >
            <span aria-hidden="true" />
          </button>
        </header>

        {!isReady ? (
          <div className="task-form-modal__loading" role="status">
            {isLoading ? (
              <>
                <span className="task-form-modal__spinner" aria-hidden="true" />
                <p>Загружаем данные задачи…</p>
              </>
            ) : (
              <>
                <p>{requestError || 'Не удалось загрузить задачу.'}</p>
                <button type="button" onClick={() => void loadForm()}>
                  Повторить
                </button>
              </>
            )}
          </div>
        ) : (
          <form
            className={`task-form task-form--${mode}`}
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
          >
            <label className="task-form__field task-form__field--title">
              <span className="task-form__visually-hidden">Название</span>
              <input
                ref={titleInputRef}
                type="text"
                value={draft.title}
                maxLength={255}
                placeholder="Название"
                required
                disabled={isSaving || isDeleting}
                aria-invalid={Boolean(validation.titleError)}
                onChange={updateField('title')}
              />
              {validation.titleError && (
                <em role="alert">{validation.titleError}</em>
              )}
            </label>

            <div className="task-form__deadline-row">
              <label className="task-form__field task-form__field--due-type">
                <span>Тип срока</span>
                <select
                  value={draft.dueDateType}
                  disabled={isSaving || isDeleting}
                  onChange={updateDueDateType}
                >
                  <option value="none">Без срока</option>
                  <option value="date">Дата</option>
                  <option value="datetime">Дата и время</option>
                </select>
              </label>

              <label className="task-form__due">
                <span>Дата выполнения</span>
                {draft.dueDateType === 'none' ? (
                  <input
                    type="text"
                    value="Без срока"
                    disabled
                    readOnly
                    aria-label="Дата выполнения: без срока"
                  />
                ) : (
                  <input
                    type={
                      draft.dueDateType === 'date' ? 'date' : 'datetime-local'
                    }
                    value={draft.dueDate}
                    disabled={isSaving || isDeleting}
                    aria-invalid={Boolean(validation.dueDateError)}
                    onChange={updateDueDate}
                  />
                )}
                {validation.dueDateError && (
                  <em role="alert">{validation.dueDateError}</em>
                )}
              </label>

              {mode === 'edit' && (
                <label className="task-form__field task-form__field--status">
                  <span>Статус</span>
                  <select
                    value={draft.status}
                    disabled={isSaving || isDeleting}
                    onChange={updateField('status')}
                  >
                    <option value="new">Новая</option>
                    <option value="in_progress">В работе</option>
                    <option value="done">Выполнена</option>
                  </select>
                </label>
              )}
            </div>

            <label className="task-form__field task-form__field--description">
              <span className="task-form__visually-hidden">Описание</span>
              <textarea
                value={draft.description}
                maxLength={1000}
                rows={4}
                placeholder="Описание"
                disabled={isSaving || isDeleting}
                onChange={updateField('description')}
              />
            </label>

            <div className="task-form__relations">
              <label className="task-form__field task-form__field--contact">
                <span className="task-form__visually-hidden">Клиент</span>
                <select
                  value={draft.contactId}
                  disabled={isSaving || isDeleting}
                  onChange={updateContact}
                >
                  <option value="">Клиент не выбран</option>
                  {contacts.map((contact) => (
                    <option value={contact.id} key={contact.id}>
                      {contact.company
                        ? `${contact.name} · ${contact.company}`
                        : contact.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="task-form__field task-form__field--deal">
                <span className="task-form__visually-hidden">Сделка</span>
                <select
                  value={draft.dealId}
                  disabled={
                    isSaving ||
                    isDeleting ||
                    (!draft.contactId && !draft.dealId)
                  }
                  onChange={updateField('dealId')}
                >
                  <option value="">Сделка не выбрана</option>
                  {filteredDeals.map((deal) => (
                    <option value={deal.id} key={deal.id}>
                      {deal.name}
                    </option>
                  ))}
                </select>
              </label>

              {mode === 'edit' && (
                <output className="task-form__amount" aria-live="polite">
                  {formatDealAmount(selectedDeal) || '—'}
                </output>
              )}
            </div>

            <label className="task-form__field task-form__field--comment">
              <span className="task-form__visually-hidden">Комментарий</span>
              <textarea
                value={draft.comment}
                maxLength={500}
                rows={2}
                placeholder="Комментарий"
                disabled={isSaving || isDeleting}
                onChange={updateField('comment')}
              />
            </label>

            {requestError && (
              <p className="task-form__request-error" role="alert">
                {requestError}
              </p>
            )}

            <footer className="task-form__actions">
              <div>
                {mode === 'edit' && (
                  <button
                    className="task-form__button task-form__button--danger"
                    type="button"
                    disabled={isSaving || isDeleting}
                    onClick={() => setIsDeleteConfirmOpen(true)}
                  >
                    Удалить
                  </button>
                )}
              </div>
              <div>
                <button
                  className="task-form__button task-form__button--secondary"
                  type="button"
                  disabled={isSaving || isDeleting}
                  onClick={requestClose}
                >
                  Отмена
                </button>
                <button
                  className="task-form__button task-form__button--primary"
                  type="submit"
                  disabled={!canSubmit}
                >
                  {isSaving
                    ? 'Сохранение…'
                    : mode === 'create'
                      ? 'Создать'
                      : 'Сохранить'}
                </button>
              </div>
            </footer>
          </form>
        )}

        {isCloseConfirmOpen && (
          <TaskDecisionDialog
            title="Закрыть окно?"
            text="Все несохранённые изменения будут потеряны."
            primaryLabel="Закрыть"
            secondaryLabel="Остаться"
            danger
            onPrimary={() => {
              setIsCloseConfirmOpen(false)
              onClose()
            }}
            onSecondary={() => setIsCloseConfirmOpen(false)}
          />
        )}

        {isConflictConfirmOpen && (
          <TaskDecisionDialog
            title="Задача была изменена другим пользователем"
            text="Ваши изменения не сохранены. Обновить данные?"
            primaryLabel="Обновить"
            secondaryLabel="Остаться"
            onPrimary={() => {
              setIsConflictConfirmOpen(false)
              void loadForm()
            }}
            onSecondary={() => setIsConflictConfirmOpen(false)}
          />
        )}

        {isDeleteConfirmOpen && (
          <TaskDecisionDialog
            title="Удалить задачу?"
            text={`Вы действительно хотите удалить задачу «${taskTitle || draft.title}»? Действие невозможно отменить.`}
            primaryLabel={isDeleting ? 'Удаление…' : 'Удалить'}
            secondaryLabel="Отмена"
            danger
            disabled={isDeleting}
            onPrimary={() => void confirmDelete()}
            onSecondary={() => setIsDeleteConfirmOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function TaskDecisionDialog({
  title,
  text,
  primaryLabel,
  secondaryLabel,
  danger = false,
  disabled = false,
  onPrimary,
  onSecondary,
}: {
  title: string
  text: string
  primaryLabel: string
  secondaryLabel: string
  danger?: boolean
  disabled?: boolean
  onPrimary: () => void
  onSecondary: () => void
}) {
  const secondaryButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    secondaryButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !disabled) {
        event.preventDefault()
        onSecondary()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [disabled, onSecondary])

  return (
    <div className="task-decision-overlay" role="presentation">
      <div
        className="task-decision"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="task-decision-title"
        aria-describedby="task-decision-text"
      >
        <h3 id="task-decision-title">{title}</h3>
        <p id="task-decision-text">{text}</p>
        <div>
          <button
            ref={secondaryButtonRef}
            type="button"
            disabled={disabled}
            onClick={onSecondary}
          >
            {secondaryLabel}
          </button>
          <button
            className={danger ? 'is-danger' : 'is-primary'}
            type="button"
            disabled={disabled}
            onClick={onPrimary}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

async function loadTaskChoices(signal: AbortSignal) {
  const contactsPromise = loadAllContacts(signal)
  const dealsPromise = loadAllDeals(signal)
  const [contacts, deals] = await Promise.all([contactsPromise, dealsPromise])
  return { contacts, deals }
}

async function loadAllContacts(signal: AbortSignal) {
  const contacts: ApiContact[] = []
  let page = 1
  let total = 1

  while (contacts.length < total) {
    const response = await getContacts(page, 100, signal)
    contacts.push(...response.contacts)
    total = response.total
    page += 1
    if (response.contacts.length === 0) {
      break
    }
  }
  return contacts
}

async function loadAllDeals(signal: AbortSignal) {
  const kanban = await getKanban(signal)
  const stageDeals = await Promise.all(
    kanban.stages.map(async (stage) => {
      const deals: ApiKanbanDeal[] = []
      let cursor: string | null = null
      let hasMore = true

      while (hasMore) {
        const response = await getDealsPage(
          stage.id,
          100,
          cursor,
          signal,
        )
        deals.push(...response.deals)
        cursor = response.next_cursor
        hasMore = response.has_more && Boolean(cursor)
      }
      return deals
    }),
  )

  return stageDeals
    .flat()
    .sort((firstDeal, secondDeal) =>
      firstDeal.name.localeCompare(secondDeal.name, 'ru'),
    )
}

function taskToDraft(task: ApiTaskDetail): TaskDraft {
  return {
    title: task.title,
    dueDateType: task.due_date_type,
    dueDate: formatDueDateInput(task),
    description: task.description ?? '',
    contactId: task.contact?.id ?? '',
    dealId: task.deal?.id ?? '',
    comment: task.comment ?? '',
    status: task.status,
  }
}

function formatDueDateInput(task: ApiTaskDetail) {
  if (!task.due_date || task.due_date_type === 'none') {
    return ''
  }

  const date = new Date(task.due_date)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  if (task.due_date_type === 'date') {
    return `${year}-${month}-${day}`
  }

  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function validateTaskDraft(draft: TaskDraft) {
  const title = draft.title.trim()
  let titleError = ''
  let dueDateError = ''

  if (!title) {
    titleError = 'Заполните название задачи.'
  } else if (title.length > 255) {
    titleError = 'Название должно содержать не больше 255 символов.'
  }

  if (draft.dueDateType !== 'none' && !draft.dueDate) {
    dueDateError = 'Укажите дату выполнения.'
  }

  return {
    isValid:
      !titleError &&
      !dueDateError &&
      draft.description.length <= 1000 &&
      draft.comment.length <= 500,
    titleError,
    dueDateError,
  }
}

function buildTaskPayload(draft: TaskDraft): CreateTaskRequest {
  return {
    title: draft.title.trim(),
    description: normalizeNullableText(draft.description),
    due_date: draft.dueDateType === 'none' ? null : draft.dueDate,
    due_date_type: draft.dueDateType,
    contact_id: draft.contactId || null,
    deal_id: draft.dealId || null,
    comment: normalizeNullableText(draft.comment),
  }
}

function serializeTaskFields(draft: TaskDraft) {
  return JSON.stringify(buildTaskPayload(draft))
}

function serializeTaskDraft(draft: TaskDraft) {
  return JSON.stringify({
    ...buildTaskPayload(draft),
    status: draft.status,
  })
}

function normalizeNullableText(value: string) {
  const normalizedValue = value.trim()
  return normalizedValue || null
}

function formatDealAmount(deal: ApiKanbanDeal | null) {
  if (!deal || deal.amount == null) {
    return ''
  }

  const amount = Number(deal.amount)
  if (!Number.isFinite(amount)) {
    return `${deal.amount} ${deal.currency}`
  }

  const formattedAmount = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount)
  const currencySymbols: Record<string, string> = {
    RUB: '₽',
    USD: '$',
    EUR: '€',
  }
  return `${formattedAmount} ${currencySymbols[deal.currency] ?? deal.currency}`
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
