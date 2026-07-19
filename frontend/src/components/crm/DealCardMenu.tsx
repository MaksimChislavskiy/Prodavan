import { useEffect, useRef, useState } from 'react'
import './DealCardMenu.css'

type DealCardMenuProps = {
  dealName: string
  disabled?: boolean
}

export function DealCardMenu({ dealName, disabled = false }: DealCardMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

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

  const closeMenu = () => {
    setIsOpen(false)
  }

  return (
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
            onClick={closeMenu}
          >
            Редактировать
          </button>
          <button
            className="deal-card-menu__item"
            type="button"
            role="menuitem"
            onClick={closeMenu}
          >
            Удалить
          </button>
        </div>
      )}
    </div>
  )
}
