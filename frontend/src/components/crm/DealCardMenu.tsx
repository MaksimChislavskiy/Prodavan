import { useEffect, useRef, useState } from 'react'
import { EditDealModal } from './EditDealModal'
import { ViewDealModal } from './ViewDealModal'
import './DealCardMenu.css'

type DealCardMenuProps = {
  dealId: string
  dealName: string
  disabled?: boolean
}

export function DealCardMenu({
  dealId,
  dealName,
  disabled = false,
}: DealCardMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
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
      if (disabled || isDraggingRef.current || !(event.target instanceof Element)) {
        return
      }

      if (
        event.target.closest('.deal-card-menu') ||
        event.target.closest('.view-deal-overlay') ||
        event.target.closest('.edit-deal-overlay')
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
  }, [disabled])

  const openEditModal = () => {
    setIsOpen(false)
    setIsEditModalOpen(true)
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
          disabled={disabled}
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
              title="Удаление подключим позже"
              onClick={() => setIsOpen(false)}
            >
              Удалить
            </button>
          </div>
        )}
      </div>

      {isViewModalOpen && (
        <ViewDealModal
          dealId={dealId}
          dealName={dealName}
          onClose={() => setIsViewModalOpen(false)}
        />
      )}

      {isEditModalOpen && (
        <EditDealModal
          dealId={dealId}
          dealName={dealName}
          onClose={() => setIsEditModalOpen(false)}
        />
      )}
    </>
  )
}
