import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react'
import { ApiError } from '../../shared/api/apiClient'
import {
  searchContacts,
  type ApiContactAutocomplete,
} from '../../shared/api/contactsApi'
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
  type ApiTaskDetail,
  type CreateTaskRequest,
  type UpdateTaskRequest,
} from '../../shared/api/tasksApi'
import { getWorkspaceSettings } from '../../shared/api/workspaceSettingsApi'
import {
  CRM_REALTIME_EVENT,
  CRM_REALTIME_RECONNECTED_EVENT,
} from '../../shared/crmRealtime'
import {
  formatTaskDueDateForDisplay,
  formatTaskDueDateForInput,
} from '../../shared/taskDateTime'
import './TaskFormModal.css'
import './TaskFormModalTzFixes.css'
import './TaskFormModalUpdatedTz.css'

type TaskFormMode = 'create' | 'view' | 'edit'
type TaskPanelMode = 'view' | 'edit'

type TaskContactOption = Pick<
  ApiContactAutocomplete,
  'id' | 'name' | 'company'
>

type TaskDraft = {
  title: string
  dueDate: string
  description: string
  contactId: string
  dealId: string
  comment: string
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

type RealtimePayload = {
  event?: string
  task?: { id?: string }
  task_id?: string
}

const emptyTaskDraft: TaskDraft = {
  title: '',
  dueDate: '',
  description: '',
  contactId: '',
  dealId: '',
  comment: '',
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

  const [panelMode, setPanelMode] = useState<TaskPanelMode>(
    mode === 'view' ? 'view' : 'edit',
  )
  const [task, setTask] = useState<ApiTaskDetail | null>(null)
  const [draft, setDraft] = useState<TaskDraft>(emptyTaskDraft)
  const [deals, setDeals] = useState<ApiKanbanDeal[]>([])
  const [selectedContact, setSelectedContact] =
    useState<TaskContactOption | null>(null)
  const [contactQuery, setContactQuery] = useState('')
  const [contactOptions, setContactOptions] = useState<ApiContactAutocomplete[]>([])
  const [contactActiveIndex, setContactActiveIndex] = useState(0)
  const [isContactSearchOpen, setIsContactSearchOpen] = useState(false)
  const [isContactSearching, setIsContactSearching] = useState(false)
  const [contactSearchError, setContactSearchError] = useState('')
  const [version, setVersion] = useState<number | null>(
    mode === 'create' ? 0 : null,
  )
  const [workspaceTimezone, setWorkspaceTimezone] = useState('UTC')
  const [initialDraft, setInitialDraft] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [externalNotice, setExternalNotice] = useState('')
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [isConflictConfirmOpen, setIsConflictConfirmOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)

  const selectedDeal = useMemo(
    () => deals.find((deal) => deal.id === draft.dealId) ?? null,
    [deals, draft.dealId],
  )

  const filteredDeals = useMemo(() => {
    if (!draft.contactId) return []
    return deals.filter((deal) => deal.contact?.id === draft.contactId)
  }, [deals, draft.contactId])

  const serializedDraft = serializeTaskDraft(draft)
  const isDirty = initialDraft !== '' && serializedDraft !== initialDraft
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
      const dealsPromise = loadAllDeals(controller.signal)
      const settingsPromise = getWorkspaceSettings(controller.signal)
      const taskPromise =
        mode !== 'create' && taskId
          ? getTask(taskId, controller.signal)
          : Promise.resolve(null)

      const [loadedDeals, workspaceSettings, loadedTask] = await Promise.all([
        dealsPromise,
        settingsPromise,
        taskPromise,
      ])

      const timezone = workspaceSettings.timezone || 'UTC'
      const nextDraft = loadedTask
        ? taskToDraft(loadedTask, timezone)
        : emptyTaskDraft
      const nextContact = loadedTask?.contact
        ? {
            id: loadedTask.contact.id,
            name: loadedTask.contact.name,
            company: loadedTask.contact.company,
          }
        : null

      setDeals(loadedDeals)
      setWorkspaceTimezone(timezone)
      setTask(loadedTask)
      setDraft(nextDraft)
      setSelectedContact(nextContact)
      setContactQuery(nextContact ? formatContactOption(nextContact) : '')
      setContactOptions([])
      setContactActiveIndex(0)
      setIsContactSearchOpen(false)
      setContactSearchError('')
      setInitialDraft(serializeTaskDraft(nextDraft))
      setVersion(loadedTask?.version ?? 0)
      setIsInitialized(true)

      if (mode === 'create' || panelMode === 'edit') {
        window.setTimeout(() => titleInputRef.current?.focus(), 0)
      }
    } catch (error) {
      if (isAbortError(error)) return
      if (
        mode !== 'create' &&
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
  }, [mode, onNotFound, panelMode, stopCurrentRequest, taskId])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timeoutId = window.setTimeout(() => void loadForm(), 0)

    return () => {
      document.body.style.overflow = originalOverflow
      window.clearTimeout(timeoutId)
      stopCurrentRequest()
    }
  }, [loadForm, stopCurrentRequest])

  useEffect(() => {
    if (mode === 'create' || !taskId) return

    const handleRealtime = (event: Event) => {
      const payload = (event as CustomEvent<RealtimePayload>).detail
      if (!payload?.event) return
      const changedTaskId = payload.task?.id || payload.task_id
      if (changedTaskId !== taskId) return

      if (payload.event === 'task_deleted') {
        onNotFound()
        return
      }

      if (payload.event === 'task_updated') {
        if (panelMode === 'edit') {
          setPanelMode('view')
          setExternalNotice(
            'Задача была изменена в другой вкладке или другим пользователем. Несохранённые изменения сброшены.',
          )
        }
        void loadForm()
      }
    }

    const handleReconnect = () => void loadForm()

    window.addEventListener(CRM_REALTIME_EVENT, handleRealtime as EventListener)
    window.addEventListener(CRM_REALTIME_RECONNECTED_EVENT, handleReconnect)
    return () => {
      window.removeEventListener(CRM_REALTIME_EVENT, handleRealtime as EventListener)
      window.removeEventListener(CRM_REALTIME_RECONNECTED_EVENT, handleReconnect)
    }
  }, [loadForm, mode, onNotFound, panelMode, taskId])

  useEffect(() => {
    if (!isInitialized || panelMode !== 'edit') return

    const query = contactQuery.trim()
    const selectedLabel = selectedContact
      ? formatContactOption(selectedContact)
      : ''

    if (selectedContact && contactQuery === selectedLabel) {
      setContactOptions([])
      setIsContactSearchOpen(false)
      setIsContactSearching(false)
      setContactSearchError('')
      return
    }

    if (query.length < 2) {
      setContactOptions([])
      setIsContactSearchOpen(false)
      setIsContactSearching(false)
      setContactSearchError('')
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setIsContactSearching(true)
      setContactSearchError('')
      try {
        const results = await searchContacts(query, 5, controller.signal)
        if (controller.signal.aborted) return
        setContactOptions(results)
        setContactActiveIndex(0)
        setIsContactSearchOpen(results.length > 0)
      } catch (error) {
        if (isAbortError(error)) return
        setContactOptions([])
        setContactSearchError('Не удалось найти контакты.')
        setIsContactSearchOpen(true)
      } finally {
        if (!controller.signal.aborted) setIsContactSearching(false)
      }
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [contactQuery, isInitialized, panelMode, selectedContact])

  const requestClose = useCallback(() => {
    if (isSaving || isDeleting) return
    if ((mode === 'create' || panelMode === 'edit') && isDirty) {
      setIsCloseConfirmOpen(true)
      return
    }
    onClose()
  }, [isDeleting, isDirty, isSaving, mode, onClose, panelMode])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        isCloseConfirmOpen ||
        isConflictConfirmOpen ||
        isDeleteConfirmOpen
      ) return

      if (event.key === 'Escape') {
        if (isContactSearchOpen) {
          setIsContactSearchOpen(false)
          return
        }
        event.preventDefault()
        requestClose()
        return
      }

      if (event.key !== 'Tab' || !modalRef.current) return
      const elements = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ),
      )
      if (elements.length === 0) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    isCloseConfirmOpen,
    isConflictConfirmOpen,
    isContactSearchOpen,
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
      setDraft((current) => ({ ...current, [field]: event.target.value }))
      setRequestError('')
    }

  const updateContactQuery = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setContactQuery(value)
    setSelectedContact(null)
    setContactOptions([])
    setContactActiveIndex(0)
    setContactSearchError('')
    setIsContactSearchOpen(value.trim().length >= 2)
    setDraft((current) => ({
      ...current,
      contactId: '',
      dealId: '',
    }))
    setRequestError('')
  }

  const selectContact = (contact: TaskContactOption) => {
    setSelectedContact(contact)
    setContactQuery(formatContactOption(contact))
    setContactOptions([])
    setContactActiveIndex(0)
    setIsContactSearchOpen(false)
    setContactSearchError('')
    setDraft((current) => {
      const currentDeal = deals.find((deal) => deal.id === current.dealId)
      return {
        ...current,
        contactId: contact.id,
        dealId:
          currentDeal?.contact?.id === contact.id ? current.dealId : '',
      }
    })
    setRequestError('')
  }

  const clearContact = () => {
    setSelectedContact(null)
    setContactQuery('')
    setContactOptions([])
    setContactActiveIndex(0)
    setIsContactSearchOpen(false)
    setContactSearchError('')
    setDraft((current) => ({ ...current, contactId: '', dealId: '' }))
    setRequestError('')
  }

  const handleContactKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === 'Escape' && isContactSearchOpen) {
      event.preventDefault()
      event.stopPropagation()
      setIsContactSearchOpen(false)
      return
    }
    if (contactOptions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIsContactSearchOpen(true)
      setContactActiveIndex((index) =>
        Math.min(index + 1, contactOptions.length - 1),
      )
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIsContactSearchOpen(true)
      setContactActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && isContactSearchOpen) {
      const active = contactOptions[contactActiveIndex]
      if (active) {
        event.preventDefault()
        selectContact(active)
      }
    }
  }

  const submitDraft = async () => {
    if (!canSubmit) return false
    if (mode !== 'create' && (!taskId || version === null)) {
      setRequestError('Не удалось определить версию задачи. Обновите данные.')
      return false
    }

    stopCurrentRequest()
    const controller = new AbortController()
    requestControllerRef.current = controller
    setIsSaving(true)
    setRequestError('')

    try {
      if (mode === 'create') {
        const payload = buildCreatePayload(draft)
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
        return true
      }

      const payload = buildUpdatePayload(draft, version as number)
      const updated = await updateTask(
        taskId as string,
        payload,
        controller.signal,
      )
      setVersion(updated.version)
      onUpdated()
      return true
    } catch (error) {
      if (isAbortError(error)) return false
      if (
        mode !== 'create' &&
        error instanceof ApiError &&
        error.status === 409
      ) {
        setIsConflictConfirmOpen(true)
      } else if (
        mode !== 'create' &&
        error instanceof ApiError &&
        error.status === 404
      ) {
        onNotFound()
      } else {
        setRequestError(
          mode === 'create'
            ? error instanceof Error
              ? error.message
              : 'Не удалось создать задачу.'
            : 'Не удалось сохранить изменения. Попробуйте позже.',
        )
      }
      return false
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
      }
      setIsSaving(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitDraft()
  }

  const confirmDelete = async () => {
    if (mode === 'create' || !taskId || isDeleting) return
    stopCurrentRequest()
    const controller = new AbortController()
    requestControllerRef.current = controller
    setIsDeleting(true)
    setRequestError('')

    try {
      await deleteTask(taskId, controller.signal)
      onDeleted()
    } catch (error) {
      if (isAbortError(error)) return
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

  const switchToEdit = () => {
    setPanelMode('edit')
    setExternalNotice('')
    setInitialDraft(serializeTaskDraft(draft))
    window.setTimeout(() => titleInputRef.current?.focus(), 0)
  }

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) requestClose()
  }

  const isReady =
    !isLoading &&
    isInitialized &&
    (mode === 'create' || (task !== null && version !== null))

  const modalTitle =
    mode === 'create'
      ? 'Создание задачи'
      : panelMode === 'view'
        ? 'Просмотр задачи'
        : 'Редактирование задачи'

  return (
    <div
      className="task-form-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className={`task-form-modal task-form-modal--${mode === 'create' ? 'create' : panelMode}`}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-form-title"
        aria-busy={isLoading || isSaving || isDeleting}
      >
        <header className="task-form-modal__header">
          <h2 id="task-form-title">{modalTitle}</h2>
          <div className="task-form-modal__header-actions">
            {mode !== 'create' && panelMode === 'view' && (
              <button
                className="task-form-modal__edit"
                type="button"
                disabled={isLoading}
                onClick={switchToEdit}
              >
                <span aria-hidden="true">✎</span>
                Редактировать
              </button>
            )}
            <button
              className="task-form-modal__close"
              type="button"
              aria-label="Закрыть"
              disabled={isSaving || isDeleting}
              onClick={requestClose}
            >
              <span aria-hidden="true" />
            </button>
          </div>
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
        ) : panelMode === 'view' && task ? (
          <TaskView
            task={task}
            workspaceTimezone={workspaceTimezone}
            externalNotice={externalNotice}
          />
        ) : (
          <form
            className={`task-form task-form--${mode === 'create' ? 'create' : 'edit'}`}
            noValidate
            onSubmit={handleSubmit}
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
              {validation.titleError && <em role="alert">{validation.titleError}</em>}
            </label>

            <div className="task-form__deadline-row task-form__deadline-row--auto-type">
              <label className="task-form__due">
                <span>Дата выполнения</span>
                <input
                  type="datetime-local"
                  value={draft.dueDate}
                  disabled={isSaving || isDeleting}
                  onChange={updateField('dueDate')}
                />
              </label>
              <p className="task-form__deadline-hint">
                Если срок не нужен, оставьте поле пустым.
              </p>
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
              <div className="task-form__field task-form__field--contact">
                <span className="task-form__visually-hidden" id="task-contact-label">
                  Клиент
                </span>
                <div className="task-form__contact-combobox">
                  <input
                    type="text"
                    value={contactQuery}
                    placeholder="Найти клиента"
                    autoComplete="off"
                    role="combobox"
                    aria-labelledby="task-contact-label"
                    aria-autocomplete="list"
                    aria-expanded={isContactSearchOpen}
                    aria-controls="task-contact-options"
                    aria-activedescendant={
                      isContactSearchOpen && contactOptions[contactActiveIndex]
                        ? `task-contact-option-${contactOptions[contactActiveIndex].id}`
                        : undefined
                    }
                    disabled={isSaving || isDeleting}
                    onChange={updateContactQuery}
                    onKeyDown={handleContactKeyDown}
                    onFocus={() => {
                      if (contactOptions.length > 0 || contactSearchError) {
                        setIsContactSearchOpen(true)
                      }
                    }}
                    onBlur={() => {
                      window.setTimeout(() => setIsContactSearchOpen(false), 120)
                    }}
                  />

                  {(contactQuery || draft.contactId) && (
                    <button
                      className="task-form__contact-clear"
                      type="button"
                      aria-label="Очистить выбранного клиента"
                      title="Очистить"
                      disabled={isSaving || isDeleting}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={clearContact}
                    >
                      ×
                    </button>
                  )}

                  {isContactSearching && (
                    <span
                      className="task-form__contact-spinner"
                      aria-label="Поиск контактов"
                      role="status"
                    />
                  )}
                </div>

                {isContactSearchOpen && (
                  <div
                    className="task-form__contact-options"
                    id="task-contact-options"
                    role="listbox"
                    aria-label="Найденные контакты"
                  >
                    {contactSearchError ? (
                      <p role="alert">{contactSearchError}</p>
                    ) : (
                      contactOptions.map((contact, index) => (
                        <button
                          className={index === contactActiveIndex ? 'is-active' : ''}
                          id={`task-contact-option-${contact.id}`}
                          type="button"
                          role="option"
                          aria-selected={index === contactActiveIndex}
                          key={contact.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setContactActiveIndex(index)}
                          onClick={() => selectContact(contact)}
                        >
                          <strong>{contact.name}</strong>
                          {contact.company && <span>{contact.company}</span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <label className="task-form__field task-form__field--deal">
                <span className="task-form__visually-hidden">Сделка</span>
                <select
                  value={draft.dealId}
                  disabled={isSaving || isDeleting || !draft.contactId}
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

              <output className="task-form__amount" aria-live="polite">
                {formatDealAmount(selectedDeal) || '—'}
              </output>
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

            {(externalNotice || requestError) && (
              <p className="task-form__request-error" role="alert">
                {requestError || externalNotice}
              </p>
            )}

            <footer className="task-form__actions">
              <div>
                {mode !== 'create' && (
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
            title={mode === 'create' ? 'Закрыть окно?' : 'Сохранить изменения?'}
            text={
              mode === 'create'
                ? 'Введённые данные будут потеряны.'
                : 'В задаче есть несохранённые изменения.'
            }
            primaryLabel={mode === 'create' ? 'Продолжить закрытие' : 'Сохранить'}
            secondaryLabel={mode === 'create' ? 'Остаться' : 'Отмена'}
            danger={mode === 'create'}
            disabled={isSaving}
            onPrimary={() => {
              setIsCloseConfirmOpen(false)
              if (mode === 'create') onClose()
              else void submitDraft()
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
              setPanelMode('view')
              void loadForm()
            }}
            onSecondary={() => setIsConflictConfirmOpen(false)}
          />
        )}

        {isDeleteConfirmOpen && (
          <TaskDecisionDialog
            title="Удалить задачу?"
            text={`Вы действительно хотите удалить задачу «${taskTitle || task?.title || draft.title}»? Действие невозможно отменить.`}
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

function TaskView({
  task,
  workspaceTimezone,
  externalNotice,
}: {
  task: ApiTaskDetail
  workspaceTimezone: string
  externalNotice: string
}) {
  return (
    <div className="task-view">
      {externalNotice && (
        <p className="task-view__notice" role="status">{externalNotice}</p>
      )}
      <TaskViewRow label="Название" value={task.title} />
      <TaskViewRow
        label="Дата выполнения"
        value={
          task.due_date
            ? formatTaskDueDateForDisplay(task, workspaceTimezone)
            : 'Не указана'
        }
      />
      <TaskViewRow label="Описание" value={task.description || 'Не указано'} multiline />
      <TaskViewRow
        label="Клиент"
        value={
          task.contact
            ? task.contact.company
              ? `${task.contact.name} · ${task.contact.company}`
              : task.contact.name
            : 'Не указан'
        }
      />
      <TaskViewRow
        label="Сделка"
        value={task.deal ? task.deal.title : 'Не указана'}
      />
      {task.deal?.amount != null && (
        <TaskViewRow label="Сумма сделки" value={formatApiDealAmount(task)} />
      )}
      <TaskViewRow label="Комментарий" value={task.comment || 'Не указан'} multiline />
    </div>
  )
}

function TaskViewRow({
  label,
  value,
  multiline = false,
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  return (
    <div className={`task-view__row${multiline ? ' task-view__row--multiline' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
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

async function loadAllDeals(signal: AbortSignal) {
  const kanban = await getKanban(signal)
  const stageDeals = await Promise.all(
    kanban.stages.map(async (stage) => {
      const items: ApiKanbanDeal[] = []
      let cursor: string | null = null
      let hasMore = true
      while (hasMore) {
        const response = await getDealsPage(stage.id, 100, cursor, signal)
        items.push(...response.deals)
        cursor = response.next_cursor
        hasMore = response.has_more && Boolean(cursor)
      }
      return items
    }),
  )

  return stageDeals
    .flat()
    .sort((first, second) => first.name.localeCompare(second.name, 'ru'))
}

function taskToDraft(
  task: ApiTaskDetail,
  workspaceTimezone: string,
): TaskDraft {
  const dueDate = formatTaskDueDateForInput(task, workspaceTimezone)
  return {
    title: task.title,
    dueDate:
      task.due_date_type === 'date' && dueDate ? `${dueDate}T00:00` : dueDate,
    description: task.description ?? '',
    contactId: task.contact?.id ?? '',
    dealId: task.deal?.id ?? '',
    comment: task.comment ?? '',
  }
}

function validateTaskDraft(draft: TaskDraft) {
  const title = draft.title.trim()
  let titleError = ''
  if (!title) titleError = 'Заполните название задачи.'
  else if (title.length > 255) {
    titleError = 'Название должно содержать не больше 255 символов.'
  }

  return {
    isValid:
      !titleError &&
      draft.description.length <= 1000 &&
      draft.comment.length <= 500,
    titleError,
  }
}

function buildCreatePayload(draft: TaskDraft): CreateTaskRequest {
  return {
    title: draft.title.trim(),
    description: normalizeNullableText(draft.description),
    due_date: draft.dueDate || null,
    contact_id: draft.contactId || null,
    deal_id: draft.dealId || null,
    comment: normalizeNullableText(draft.comment),
  }
}

function buildUpdatePayload(
  draft: TaskDraft,
  version: number,
): UpdateTaskRequest {
  return {
    version,
    title: draft.title.trim(),
    description: normalizeNullableText(draft.description),
    due_date: draft.dueDate || null,
    ...(draft.dueDate ? {} : { due_date_type: 'none' as const }),
    contact_id: draft.contactId || null,
    deal_id: draft.dealId || null,
    comment: normalizeNullableText(draft.comment),
  }
}

function serializeTaskDraft(draft: TaskDraft) {
  return JSON.stringify({
    title: draft.title.trim(),
    description: normalizeNullableText(draft.description),
    due_date: draft.dueDate || null,
    contact_id: draft.contactId || null,
    deal_id: draft.dealId || null,
    comment: normalizeNullableText(draft.comment),
  })
}

function normalizeNullableText(value: string) {
  const normalized = value.trim()
  return normalized || null
}

function formatContactOption(contact: TaskContactOption) {
  return contact.company
    ? `${contact.name} · ${contact.company}`
    : contact.name
}

function formatDealAmount(deal: ApiKanbanDeal | null) {
  if (!deal || deal.amount == null) return ''
  return formatMoney(deal.amount, deal.currency)
}

function formatApiDealAmount(task: ApiTaskDetail) {
  if (!task.deal || task.deal.amount == null) return ''
  return formatMoney(task.deal.amount, task.deal.currency)
}

function formatMoney(amountValue: string | number, currencyCode: string) {
  const amount = Number(amountValue)
  if (!Number.isFinite(amount)) return `${amountValue} ${currencyCode}`
  const formatted = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount)
  const symbols: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' }
  return `${formatted} ${symbols[currencyCode] ?? currencyCode}`
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
