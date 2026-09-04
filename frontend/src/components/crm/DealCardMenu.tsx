import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { deleteDeal } from '../../shared/api/dealsApi'
import { showCrmToast } from '../../shared/crmToast'
import { DeleteDealConfirmModal } from './DeleteDealConfirmModal'
import { EditDealModal } from './EditDealModal'
import { ViewDealModal } from './ViewDealModal'
import './DealCardMenu.css'

type DealCardMenuProps = {
  dealId: string
  dealName: string
  disabled?: boolean
  onDeleted: (dealId: string) => void
}

export function DealCardMenu({
  dealId,
  dealName,
  disabled = false,
  onDeleted,
}: DealCardMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

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

    const handleKeyDown = (event: KeyboardEvent) => {
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
    const card = rootRef.current?.closest<HTMLElement>('.deals-card')

    if (!card) {
      return
    }

    let dragEndTimeout: number | undefined

    const handleCardDragStart = () => {
      isDraggingRef.current = true
    }

    const handleCardDragEnd = () => {
      dragEndTimeout = window.setTimeout(() => {
        isDraggingRef.current = false
      }, 0)
    }

    const handleCardClick = (event: Event) => {
      if (
        disabled ||
        isDeleting ||
        isDraggingRef.current ||
        !(event.target instanceof Element)
      ) {
        return
      }

      if (
        event.target.closest('.deal-card-menu') ||
        event.target.closest('.view-deal-overlay') ||
        event.target.closest('.edit-deal-overlay') ||
        event.target.closest('.delete-deal-overlay')
      ) {
        return
      }

      setIsViewModalOpen(true)
    }

    card.addEventListener('dragstart', handleCardDragStart)
    card.addEventListener('dragend', handleCardDragEnd)
    card.addEventListener('click', handleCardClick)

    return () => {
      if (dragEndTimeout !== undefined) {
        window.clearTimeout(dragEndTimeout)
      }

      card.removeEventListener('dragstart', handleCardDragStart)
      card.removeEventListener('dragend', handleCardDragEnd)
      card.removeEventListener('click', handleCardClick)
    }
  }, [disabled, isDeleting])

  const openEditModal = () => {
    setIsOpen(false)
    setIsEditModalOpen(true)
  }

  const openDeleteConfirm = () => {
    setIsOpen(false)
    setDeleteError('')
    setIsDeleteConfirmOpen(true)
  }

  const closeDeleteConfirm = () => {
    if (isDeleting) {
      return
    }

    setIsDeleteConfirmOpen(false)
    setDeleteError('')
  }

  const confirmDelete = async () => {
    if (isDeleting) {
      return
    }

    setIsDeleting(true)
    setDeleteError('')

    try {
      await deleteDeal(dealId)
      setIsDeleteConfirmOpen(false)
      setIsViewModalOpen(false)
      setIsEditModalOpen(false)
      onDeleted(dealId)
      showCrmToast('Сделка успешно удалена')
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Не удалось удалить сделку.',
      )
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div
        className="deal-card-menu"
        ref={rootRef}
        onDragStart={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <button
          className="deal-card-menu__trigger"
          type="button"
          aria-label={`Меню сделки ${dealName}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          title="Действия со сделкой"
          disabled={disabled || isDeleting}
          draggable={false}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setIsOpen((currentValue) => !currentValue)}
        >
          ⋮
        </button>

        {isOpen && (
          <div
            className="deal-card-menu__popup"
            role="menu"
            aria-label={`Действия со сделкой ${dealName}`}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              className="deal-card-menu__item"
              type="button"
              role="menuitem"
              onClick={openEditModal}
            >
              Редактировать
            </button>
            <button
              className="deal-card-menu__item"
              type="button"
              role="menuitem"
              onClick={openDeleteConfirm}
            >
              Удалить
            </button>
          </div>
        )}
      </div>

      {isViewModalOpen && createPortal(
        <ViewDealModal
          dealId={dealId}
          dealName={dealName}
          onClose={() => setIsViewModalOpen(false)}
        />,
        document.body,
      )}

      {isEditModalOpen && createPortal(
        <EditDealModal
          dealId={dealId}
          dealName={dealName}
          onClose={() => setIsEditModalOpen(false)}
        />,
        document.body,
      )}

      {isDeleteConfirmOpen && createPortal(
        <DeleteDealConfirmModal
          dealName={dealName}
          isDeleting={isDeleting}
          error={deleteError}
          onCancel={closeDeleteConfirm}
          onConfirm={() => void confirmDelete()}
        />,
        document.body,
      )}
    </>
  )
}
