import { useEffect, useState, type DragEvent, type FormEvent } from 'react'
import {
  createSalesStage,
  getKanban,
  moveDeal,
  type ApiKanbanDeal,
  type ApiKanbanResponse,
  type ApiSalesStage,
} from '../../shared/api/dealsApi'
import { CreateDealModal } from './CreateDealModal'
import { DealCardMenu } from './DealCardMenu'
import { StageMenu } from './StageMenu'
import './DealsPage.css'

type DealsPageState = {
  data: ApiKanbanResponse | null
  isLoading: boolean
  error: string
}

type DraggedDeal = {
  deal: ApiKanbanDeal
  sourceStageId: string
}

const initialState: DealsPageState = {
  data: null,
  isLoading: true,
  error: '',
}

export function DealsPage() {
  const [state, setState] = useState<DealsPageState>(initialState)
  const [requestVersion, setRequestVersion] = useState(0)
  const [isStageEditorOpen, setIsStageEditorOpen] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [isStageSaving, setIsStageSaving] = useState(false)
  const [stageCreateError, setStageCreateError] = useState('')
  const [draggedDeal, setDraggedDeal] = useState<DraggedDeal | null>(null)
  const [dropTargetStageId, setDropTargetStageId] = useState('')
  const [movingDealId, setMovingDealId] = useState('')
  const [dealMoveError, setDealMoveError] = useState('')
  const [isDealModalOpen, setIsDealModalOpen] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadKanban() {
      setState((currentState) => ({
        ...currentState,
        isLoading: true,
        error: '',
      }))

      try {
        const data = await getKanban()

        if (!isMounted) {
          return
        }

        setState({
          data,
          isLoading: false,
          error: '',
        })
      } catch (error) {
        if (!isMounted) {
          return
        }

        setState({
          data: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Не удалось загрузить сделки',
        })
      }
    }

    void loadKanban()

    return () => {
      isMounted = false
    }
  }, [requestVersion])

  const openStageEditor = () => {
    setNewStageName('')
    setStageCreateError('')
    setIsStageEditorOpen(true)
  }

  const closeStageEditor = () => {
    if (isStageSaving) {
      return
    }

    setIsStageEditorOpen(false)
    setNewStageName('')
    setStageCreateError('')
  }

  const handleStageCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!state.data || isStageSaving) {
      return
    }

    const name = newStageName.trim()

    if (!name) {
      setStageCreateError('Введите название этапа.')
      return
    }

    if (name.length > 100) {
      setStageCreateError('Название этапа должно содержать не больше 100 символов.')
      return
    }

    const normalizedName = normalizeStageName(name)
    const isDuplicate = state.data.stages.some(
      (stage) => normalizeStageName(stage.name) === normalizedName,
    )

    if (isDuplicate) {
      setStageCreateError('Этап с таким названием уже существует.')
      return
    }

    setIsStageSaving(true)
    setStageCreateError('')

    try {
      const createdStage = await createSalesStage({
        name,
        order: state.data.stages.length + 1,
      })

      setState((currentState) => {
        if (!currentState.data) {
          return currentState
        }

        return {
          ...currentState,
          data: {
            stages: [
              ...currentState.data.stages,
              {
                ...createdStage,
                deal_count: 0,
              },
            ].sort((firstStage, secondStage) => firstStage.order - secondStage.order),
            deals: {
              ...currentState.data.deals,
              [createdStage.id]: [],
            },
          },
        }
      })

      setIsStageEditorOpen(false)
      setNewStageName('')
    } catch (error) {
      setStageCreateError(
        error instanceof Error ? error.message : 'Не удалось создать этап.',
      )
    } finally {
      setIsStageSaving(false)
    }
  }

  const handleStageRenamed = (updatedStage: ApiSalesStage) => {
    setState((currentState) => {
      if (!currentState.data) {
        return currentState
      }

      return {
        ...currentState,
        data: {
          ...currentState.data,
          stages: currentState.data.stages.map((stage) =>
            stage.id === updatedStage.id ? updatedStage : stage,
          ),
        },
      }
    })
  }

  const handleStageDeleted = (_stageId: string) => {
    setRequestVersion((currentVersion) => currentVersion + 1)
  }

  const handleDealCreated = (createdDeal: ApiKanbanDeal) => {
    setState((currentState) => {
      if (!currentState.data) {
        return currentState
      }

      const systemStage = currentState.data.stages.find((stage) => stage.is_system)

      if (!systemStage) {
        return currentState
      }

      const currentDeals = currentState.data.deals[systemStage.id] ?? []

      return {
        ...currentState,
        data: {
          stages: currentState.data.stages.map((stage) =>
            stage.id === systemStage.id
              ? { ...stage, deal_count: stage.deal_count + 1 }
              : stage,
          ),
          deals: {
            ...currentState.data.deals,
            [systemStage.id]: [
              createdDeal,
              ...currentDeals.filter((deal) => deal.id !== createdDeal.id),
            ],
          },
        },
      }
    })
  }

  const handleDealDeleted = (dealId: string, stageId: string) => {
    setState((currentState) => {
      if (!currentState.data) {
        return currentState
      }

      const stageDeals = currentState.data.deals[stageId] ?? []
      const hasDeal = stageDeals.some((deal) => deal.id === dealId)

      if (!hasDeal) {
        return currentState
      }

      return {
        ...currentState,
        data: {
          stages: currentState.data.stages.map((stage) =>
            stage.id === stageId
              ? {
                  ...stage,
                  deal_count: Math.max(0, stage.deal_count - 1),
                }
              : stage,
          ),
          deals: {
            ...currentState.data.deals,
            [stageId]: stageDeals.filter((deal) => deal.id !== dealId),
          },
        },
      }
    })
  }

  const handleDealDragStart = (
    event: DragEvent<HTMLElement>,
    deal: ApiKanbanDeal,
    sourceStageId: string,
  ) => {
    if (movingDealId) {
      event.preventDefault()
      return
    }

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', deal.id)
    setDraggedDeal({ deal, sourceStageId })
    setDropTargetStageId('')
    setDealMoveError('')
  }

  const handleDealDragEnd = () => {
    setDraggedDeal(null)
    setDropTargetStageId('')
  }

  const handleStageDragOver = (
    event: DragEvent<HTMLElement>,
    targetStageId: string,
  ) => {
    if (
      !draggedDeal ||
      movingDealId ||
      draggedDeal.sourceStageId === targetStageId
    ) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    if (dropTargetStageId !== targetStageId) {
      setDropTargetStageId(targetStageId)
    }
  }

  const handleStageDragLeave = (
    event: DragEvent<HTMLElement>,
    stageId: string,
  ) => {
    const relatedTarget = event.relatedTarget

    if (
      dropTargetStageId === stageId &&
      (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget))
    ) {
      setDropTargetStageId('')
    }
  }

  const handleStageDrop = (
    event: DragEvent<HTMLElement>,
    targetStageId: string,
  ) => {
    event.preventDefault()
    void moveDraggedDeal(targetStageId)
  }

  const moveDraggedDeal = async (targetStageId: string) => {
    const dragged = draggedDeal

    setDraggedDeal(null)
    setDropTargetStageId('')

    if (
      !dragged ||
      movingDealId ||
      dragged.sourceStageId === targetStageId
    ) {
      return
    }

    setMovingDealId(dragged.deal.id)
    setDealMoveError('')

    try {
      const updatedDeal = await moveDeal(dragged.deal.id, {
        stage_id: targetStageId,
        version: dragged.deal.version,
      })

      setState((currentState) => {
        if (!currentState.data) {
          return currentState
        }

        const sourceDeals = currentState.data.deals[dragged.sourceStageId] ?? []
        const targetDeals = currentState.data.deals[targetStageId] ?? []

        return {
          ...currentState,
          data: {
            stages: currentState.data.stages.map((stage) => {
              if (stage.id === dragged.sourceStageId) {
                return {
                  ...stage,
                  deal_count: Math.max(0, stage.deal_count - 1),
                }
              }

              if (stage.id === targetStageId) {
                return {
                  ...stage,
                  deal_count: stage.deal_count + 1,
                }
              }

              return stage
            }),
            deals: {
              ...currentState.data.deals,
              [dragged.sourceStageId]: sourceDeals.filter(
                (deal) => deal.id !== dragged.deal.id,
              ),
              [targetStageId]: [
                updatedDeal,
                ...targetDeals.filter((deal) => deal.id !== dragged.deal.id),
              ],
            },
          },
        }
      })
    } catch (error) {
      setDealMoveError(
        error instanceof Error ? error.message : 'Не удалось переместить сделку.',
      )
      setRequestVersion((currentVersion) => currentVersion + 1)
    } finally {
      setMovingDealId('')
    }
  }

  if (state.isLoading) {
    return <DealsSkeleton />
  }

  if (state.error || !state.data) {
    return (
      <section className="deals-state-card" aria-live="polite">
        <h1 className="deals-state-card__title">Не удалось загрузить сделки</h1>
        <p className="deals-state-card__text">{state.error}</p>
        <button
          className="deals-state-card__button"
          type="button"
          onClick={() => setRequestVersion((currentVersion) => currentVersion + 1)}
        >
          Повторить
        </button>
      </section>
    )
  }

  const { stages, deals } = state.data

  const systemStageName =
    stages.find((stage) => stage.is_system)?.name ?? 'Новый лид'

  return (
    <>
      <section className="deals-page" aria-label="Сделки">
        {dealMoveError && (
          <p className="deals-page__error" role="alert">
            {dealMoveError}
          </p>
        )}

        <div className="deals-board" aria-label="Воронка сделок">
          {stages.map((stage) => {
            const stageDeals = deals[stage.id] ?? []
            const isDropTarget = dropTargetStageId === stage.id
            const otherStageNames = stages
              .filter((otherStage) => otherStage.id !== stage.id)
              .map((otherStage) => otherStage.name)

            return (
              <article
                className={`deals-column${isDropTarget ? ' deals-column--drop-target' : ''}`}
                key={stage.id}
                onDragOver={(event) => handleStageDragOver(event, stage.id)}
                onDragLeave={(event) => handleStageDragLeave(event, stage.id)}
                onDrop={(event) => handleStageDrop(event, stage.id)}
              >
                <header className="deals-stage">
                  <div className="deals-stage__meta">
                    <span className="deals-stage__title" title={stage.name}>
                      {stage.name}
                    </span>
                    <span className="deals-stage__count">{stage.deal_count}</span>
                  </div>

                  {stage.is_system ? (
                    <button
                      className="deals-stage__action deals-stage__action--add"
                      type="button"
                      aria-label="Добавить сделку"
                      title="Создать сделку"
                      onClick={() => setIsDealModalOpen(true)}
                    >
                      +
                    </button>
                  ) : (
                    <StageMenu
                      stage={stage}
                      otherStageNames={otherStageNames}
                      systemStageName={systemStageName}
                      onRenamed={handleStageRenamed}
                      onDeleted={handleStageDeleted}
                    />
                  )}
                </header>

                <div className="deals-column__cards">
                  {stageDeals.map((deal) => (
                    <DealCard
                      deal={deal}
                      isMoving={movingDealId === deal.id}
                      key={deal.id}
                      onDeleted={(deletedDealId) =>
                        handleDealDeleted(deletedDealId, stage.id)
                      }
                      onDragStart={(event) => handleDealDragStart(event, deal, stage.id)}
                      onDragEnd={handleDealDragEnd}
                    />
                  ))}
                </div>
              </article>
            )
          })}

          <article className="deals-column deals-column--add-stage">
            {isStageEditorOpen ? (
              <form
                className="deals-stage-create"
                onSubmit={(event) => void handleStageCreate(event)}
              >
                <div className="deals-stage-create__row">
                  <input
                    className="deals-stage-create__input"
                    type="text"
                    value={newStageName}
                    maxLength={100}
                    autoFocus
                    placeholder="Название этапа"
                    aria-label="Название нового этапа"
                    disabled={isStageSaving}
                    onChange={(event) => {
                      setNewStageName(event.target.value)
                      setStageCreateError('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        closeStageEditor()
                      }
                    }}
                  />

                  <button
                    className="deals-stage-create__button deals-stage-create__button--save"
                    type="submit"
                    aria-label="Сохранить этап"
                    disabled={isStageSaving || !newStageName.trim()}
                  >
                    {isStageSaving ? '…' : '✓'}
                  </button>

                  <button
                    className="deals-stage-create__button"
                    type="button"
                    aria-label="Отменить создание этапа"
                    disabled={isStageSaving}
                    onClick={closeStageEditor}
                  >
                    ×
                  </button>
                </div>

                {stageCreateError && (
                  <p className="deals-stage-create__error" role="alert">
                    {stageCreateError}
                  </p>
                )}
              </form>
            ) : (
              <button
                className="deals-add-stage"
                type="button"
                aria-label="Добавить этап"
                onClick={openStageEditor}
              >
                +
              </button>
            )}
          </article>
        </div>
      </section>

      {isDealModalOpen && (
        <CreateDealModal
          onClose={() => setIsDealModalOpen(false)}
          onCreated={handleDealCreated}
        />
      )}
    </>
  )
}

type DealCardProps = {
  deal: ApiKanbanDeal
  isMoving: boolean
  onDeleted: (dealId: string) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

function DealCard({
  deal,
  isMoving,
  onDeleted,
  onDragStart,
  onDragEnd,
}: DealCardProps) {
  return (
    <article
      className={`deals-card${isMoving ? ' deals-card--moving' : ''}`}
      draggable={!isMoving}
      aria-grabbed="false"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="deals-card__header">
        <h2 className="deals-card__title" title={deal.name}>
          {deal.name}
        </h2>
        <DealCardMenu
          dealId={deal.id}
          dealName={deal.name}
          disabled={isMoving}
          onDeleted={onDeleted}
        />
      </div>

      <div className="deals-card__line" />

      <div className="deals-card__body">
        <span className="deals-card__customer" title={getContactName(deal)}>
          {getContactName(deal)}
        </span>
        <span className="deals-card__amount">{formatDealAmount(deal)}</span>
        <span className="deals-card__date">{formatDealDate(deal.created_at)}</span>
      </div>
    </article>
  )
}

function DealsSkeleton() {
  return (
    <section className="deals-page" aria-label="Загружаем сделки" aria-busy="true">
      <div className="deals-board deals-board--skeleton">
        {Array.from({ length: 4 }, (_, index) => (
          <article className="deals-column" key={index}>
            <div className="deals-skeleton deals-skeleton--stage" />
            <div className="deals-skeleton deals-skeleton--card" />
          </article>
        ))}
      </div>
    </section>
  )
}

function normalizeStageName(name: string) {
  return name.trim().toLocaleLowerCase('ru-RU')
}

function getContactName(deal: ApiKanbanDeal) {
  return deal.contact?.name || 'Контакт не указан'
}

function formatDealAmount(deal: ApiKanbanDeal) {
  if (deal.amount === null) {
    return 'Не указана'
  }

  const amount = Number(deal.amount)

  if (!Number.isFinite(amount)) {
    return `${deal.amount} ${deal.currency}`
  }

  const formattedAmount = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount)

  return deal.currency === 'RUB'
    ? `${formattedAmount} ₽`
    : `${formattedAmount} ${deal.currency}`
}

function formatDealDate(date: string) {
  const parsedDate = new Date(date)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Дата не указана'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsedDate)
}
