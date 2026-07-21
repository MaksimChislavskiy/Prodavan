import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  deleteSalesStage,
  updateSalesStage,
  type ApiSalesStage,
} from '../../shared/api/dealsApi'
import './StageMenu.css'

type StageMenuProps = {
  stage: ApiSalesStage
  otherStageNames: string[]
  systemStageName: string
  onRenamed: (stage: ApiSalesStage) => void
  onDeleted: (stageId: string) => void
}

export function StageMenu({
  stage,
  otherStageNames,
  systemStageName,
  onRenamed,
  onDeleted,
}: StageMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [draftName, setDraftName] = useState(stage.name)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || rootRef.current?.contains(event.target)) {
        return
      }

      setIsOpen(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isRenameOpen && !isDeleteOpen) {
      return
    }

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const timeoutId = window.setTimeout(() => {
      if (isRenameOpen) {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      } else {
        deleteCancelRef.current?.focus()
      }
    }, 0)

    return () => {
      document.body.style.overflow = originalOverflow
      window.clearTimeout(timeoutId)
    }
  }, [isDeleteOpen, isRenameOpen])

  const openRename = () => {
    setIsOpen(false)
    setDraftName(stage.name)
    setRenameError('')
    setIsRenameOpen(true)
  }

  const openDelete = () => {
    setIsOpen(false)
    setDeleteError('')
    setIsDeleteOpen(true)
  }

  const closeRename = () => {
    if (isSaving) {
      return
    }

    setIsRenameOpen(false)
    setRenameError('')
  }

  const closeDelete = () => {
    if (isDeleting) {
      return
    }

    setIsDeleteOpen(false)
    setDeleteError('')
  }

  const handleRenameSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isSaving) {
      return
    }

    const name = draftName.trim()

    if (!name) {
      setRenameError('Введите название этапа.')
      return
    }

    if (name.length > 100) {
      setRenameError('Название этапа должно содержать не больше 100 символов.')
      return
    }

    const normalizedName = normalizeStageName(name)
    const isDuplicate = otherStageNames.some(
      (stageName) => normalizeStageName(stageName) === normalizedName,
    )

    if (isDuplicate) {
      setRenameError('Этап с таким названием уже существует.')
      return
    }

    if (name === stage.name) {
      setIsRenameOpen(false)
      return
    }

    try {
      setIsSaving(true)
      setRenameError('')

      const updatedStage = await updateSalesStage(stage.id, {
        version: stage.version,
        name,
      })

      onRenamed({
        ...updatedStage,
        deal_count: stage.deal_count,
      })
      setIsRenameOpen(false)
    } catch (error) {
      setRenameError(
        error instanceof Error ? error.message : 'Не удалось переименовать этап.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (isDeleting) {
      return
    }

    try {
      setIsDeleting(true)
      setDeleteError('')
      await deleteSalesStage(stage.id, stage.version)
      setIsDeleteOpen(false)
      onDeleted(stage.id)
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Не удалось удалить этап.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRenameOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!isSaving && event.target === event.currentTarget) {
      closeRename()
    }
  }

  const handleDeleteOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!isDeleting && event.target === event.currentTarget) {
      closeDelete()
    }
  }

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isSaving && event.key === 'Escape') {
      closeRename()
    }
  }

  const handleDeleteKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isDeleting && event.key === 'Escape') {
      closeDelete()
    }
  }

  return (
    <>
      <div className="stage-menu" ref={rootRef}>
        <button
          className="stage-menu__trigger"
          type="button"
          aria-label={`Меню этапа ${stage.name}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          title="Управление этапом"
          onClick={() => setIsOpen((currentValue) => !currentValue)}
        >
          ⋮
        </button>

        {isOpen && (
          <div
            className="stage-menu__popup"
            role="menu"
            aria-label={`Действия с этапом ${stage.name}`}
          >
            <button
              className="stage-menu__item"
              type="button"
              role="menuitem"
              onClick={openRename}
            >
              Переименовать
            </button>
            <button
              className="stage-menu__item stage-menu__item--danger"
              type="button"
              role="menuitem"
              onClick={openDelete}
            >
              Удалить
            </button>
          </div>
        )}
      </div>

      {isRenameOpen && (
        <div
          className="stage-menu-modal-overlay"
          role="presentation"
          onMouseDown={handleRenameOverlayMouseDown}
          onKeyDown={handleRenameKeyDown}
        >
          <div
            className="stage-menu-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-stage-title"
            aria-busy={isSaving}
            tabIndex={-1}
          >
            <h2 id="rename-stage-title">Переименовать этап</h2>

            <form onSubmit={(event) => void handleRenameSubmit(event)}>
              <label className="stage-menu-modal__field">
                <span>Название этапа</span>
                <input
                  ref={renameInputRef}
                  type="text"
                  value={draftName}
                  maxLength={100}
                  disabled={isSaving}
                  onChange={(event) => {
                    setDraftName(event.target.value)
                    setRenameError('')
                  }}
                />
              </label>

              {renameError && (
                <p className="stage-menu-modal__error" role="alert">
                  {renameError}
                </p>
              )}

              <div className="stage-menu-modal__actions">
                <button
                  className="stage-menu-modal__button stage-menu-modal__button--secondary"
                  type="button"
                  disabled={isSaving}
                  onClick={closeRename}
                >
                  Отмена
                </button>
                <button
                  className="stage-menu-modal__button stage-menu-modal__button--primary"
                  type="submit"
                  disabled={isSaving || !draftName.trim()}
                >
                  {isSaving ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeleteOpen && (
        <div
          className="stage-menu-modal-overlay"
          role="presentation"
          onMouseDown={handleDeleteOverlayMouseDown}
          onKeyDown={handleDeleteKeyDown}
        >
          <div
            className="stage-menu-modal stage-menu-modal--delete"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-stage-title"
            aria-describedby="delete-stage-description"
            aria-busy={isDeleting}
            tabIndex={-1}
          >
            <h2 id="delete-stage-title">Удалить этап «{stage.name}»?</h2>
            <p id="delete-stage-description">
              Все сделки этого этапа будут перенесены в «{systemStageName}».
            </p>

            {deleteError && (
              <p className="stage-menu-modal__error" role="alert">
                {deleteError}
              </p>
            )}

            <div className="stage-menu-modal__actions">
              <button
                className="stage-menu-modal__button stage-menu-modal__button--danger"
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDeleteConfirm()}
              >
                {isDeleting ? 'Удаляем…' : 'Удалить'}
              </button>
              <button
                ref={deleteCancelRef}
                className="stage-menu-modal__button stage-menu-modal__button--primary"
                type="button"
                disabled={isDeleting}
                onClick={closeDelete}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function normalizeStageName(name: string) {
  return name.trim().toLocaleLowerCase('ru-RU')
}
