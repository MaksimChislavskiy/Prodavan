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

type TaskContactOption = Pick<
  ApiContactAutocomplete,
  'id' | 'name' | 'company'
>

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
      const dealsPromise = loadAllDeals(controller.signal)
      const taskPromise =
        mode === 'edit' && taskId
          ? getTask(taskId, controller.signal)
          : Promise.resolve(null)
      const [loadedDeals, task] = await Promise.all([dealsPromise, taskPromise])

      setDeals(loadedDeals)

      const nextDraft = task ? taskToDraft(task) : emptyTaskDraft
      const nextContact = task?.contact
        ? {
            id: task.contact.id,
            name: task.contact.name,
            company: task.contact.company,
          }
        : null

      setDraft(nextDraft)
      setSelectedContact(nextContact)
      setContactQuery(nextContact ? formatContactOption(nextContact) : '')
      setContactOptions([])
      setContactActiveIndex(0)
      setIsContactSearchOpen(false)
      setContactSearchError('')
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
    if (!isInitialized) {
      return
    }

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

        if (controller.signal.aborted) {
          return
        }

        setContactOptions(results)
        setContactActiveIndex(0)
        setIsContactSearchOpen(results.length > 0)
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        setContactOptions([])
        setContactSearchError('Не удалось найти контакты.')
        setIsContactSearchOpen(true)
      } finally {
        if (!controller.signal.aborted) {
          setIsContactSearching(false)
        }
      }
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [contactQuery, isInitialized, selectedContact])

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
        if (isContactSearchOpen) {
          setIsContactSearchOpen(false)
          return
        }

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

  const updateContactQuery = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value

    setContactQuery(value)
    setSelectedContact(null)
    setContactOptions([])
    setContactActiveIndex(0)
    setContactSearchError('')
    setIsContactSearchOpen(value.trim().length >= 2)
    setDraft((currentDraft) => ({
      ...currentDraft,
      contactId: '',
      dealId: currentDraft.contactId ? '' : currentDraft.dealId,
    }))
    setRequestError('')
  }

  const selectContact = (contact: TaskContactOption) => {
    const label = formatContactOption(contact)

    setSelectedContact(contact)
    setContactQuery(label)
    setContactOptions([])
    setContactActiveIndex(0)
    setIsContactSearchOpen(false)
    setContactSearchError('')
    setDraft((currentDraft) => {
      const selectedTaskDeal = deals.find(
        (deal) => deal.id === currentDraft.dealId,
      )
      const canKeepDeal =
        selectedTaskDeal?.contact?.id === contact.id

      return {
        ...currentDraft,
        contactId: contact.id,
        dealId: canKeepDeal ? currentDraft.dealId : '',
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
    setDraft((currentDraft) => ({
      ...currentDraft,
      contactId: '',
      dealId: currentDraft.contactId ? '' : currentDraft.dealId,
    }))
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

    if (contactOptions.length === 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      setIsContactSearchOpen(true)
      setContactActiveIndex((currentIndex) =>
        Math.min(currentIndex + 1, contactOptions.length - 1),
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setIsContactSearchOpen(true)
      setContactActiveIndex((currentIndex) => Math.max(currentIndex - 1, 0))
      return
    }

    if (event.key === 'Enter' && isContactSearchOpen) {
      const activeContact = contactOptions[contactActiveIndex]

      if (activeContact) {
        event.preventDefault()
        event.stopPropagation()
        selectContact(activeContact)
      }
    }
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
              <div className="task-form__field task-form__field--contact">
                <span
                  className="task-form__visually-hidden"
                  id="task-contact-label"
                >
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
                    ) : contactOptions.length > 0 ? (
                      contactOptions.map((contact, index) => (
                        <button
                          className={
                            index === contactActiveIndex ? 'is-active' : ''
                          }
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
                    ) : null}
                  </div>
                )}
              </div>

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

async function loadAllDeals(signal: AbortSignal) {
  const kanban = await getKanban(signal)
  const stageDeals = await Promise.all(
    kanban.stages.map(async (stage) => {
      const stageDeals: ApiKanbanDeal[] = []
      let cursor: string | null = null
      let hasMore = true

      while (hasMore) {
        const response = await getDealsPage(
          stage.id,
          100,
          cursor,
          signal,
        )
        stageDeals.push(...response.deals)
        cursor = response.next_cursor
        hasMore = response.has_more && Boolean(cursor)
      }

      return stageDeals
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

function formatContactOption(contact: TaskContactOption) {
  return contact.company
    ? `${contact.name} · ${contact.company}`
    : contact.name
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
