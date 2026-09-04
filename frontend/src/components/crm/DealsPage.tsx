import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react'
import { ApiError } from '../../shared/api/apiClient'
import {
  createSalesStage,
  getDealsPage,
  getKanban,
  moveDeal,
  type ApiKanbanDeal,
  type ApiKanbanResponse,
  type ApiSalesStage,
} from '../../shared/api/dealsApi'
import {
  CRM_REALTIME_EVENT,
  CRM_REALTIME_RECONNECTED_EVENT,
} from '../../shared/crmRealtime'
import { showCrmToast } from '../../shared/crmToast'
import { CreateDealModal } from './CreateDealModal'
import { DealCardMenu } from './DealCardMenu'
import { StageMenu } from './StageMenu'
import './DealsPage.css'
import './DealsPageContract.css'

type DealsPageState = {
  data: ApiKanbanResponse | null
  isLoading: boolean
  error: string
}

type DraggedDeal = {
  deal: ApiKanbanDeal
  sourceStageId: string
}

type ContactFilter = {
  id: string
  name: string
}

type StagePagingState = {
  nextCursor: string | null
  cursorPrimed: boolean
  isLoading: boolean
  exhausted: boolean
  error: string
}

type RealtimePayload = {
  event?: unknown
  deal_id?: unknown
  data?: {
    deal_id?: unknown
  }
}

const DEAL_REALTIME_EVENTS = new Set([
  'deal_created',
  'deal_updated',
  'deal_stage_changed',
  'deals_stage_changed_batch',
  'deal_deleted',
  'stage_created',
  'stage_updated',
  'stage_deleted',
])

const initialState: DealsPageState = {
  data: null,
  isLoading: true,
  error: '',
}

const emptyPagingState: StagePagingState = {
  nextCursor: null,
  cursorPrimed: false,
  isLoading: false,
  exhausted: false,
  error: '',
}

export function DealsPage() {
  const [state, setState] = useState<DealsPageState>(initialState)
  const [contactFilter, setContactFilter] = useState<ContactFilter | null>(
    getContactFilterFromLocation,
  )
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
  const [pagingByStage, setPagingByStage] = useState<Record<string, StagePagingState>>({})

  useEffect(() => {
    const controller = new AbortController()

    async function loadKanban() {
      setState((currentState) => ({
        ...currentState,
        isLoading: true,
        error: '',
      }))

      try {
        let data = await getKanban(controller.signal)

        if (contactFilter) {
          data = await filterKanbanByContact(data, contactFilter.id, controller.signal)
        }

        if (controller.signal.aborted) {
          return
        }

        setState({
          data,
          isLoading: false,
          error: '',
        })
        setPagingByStage(createPagingState(data, Boolean(contactFilter)))
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        setState((currentState) => ({
          data: currentState.data,
          isLoading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось загрузить канбан-доску.',
        }))
      }
    }

    void loadKanban()
    return () => controller.abort()
  }, [contactFilter, requestVersion])

  useEffect(() => {
    const handleRealtime = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return
      }

      const payload = event.detail as RealtimePayload | null
      const eventName = typeof payload?.event === 'string' ? payload.event : ''
      if (!DEAL_REALTIME_EVENTS.has(eventName)) {
        return
      }

      const eventDealId = getRealtimeDealId(payload)
      if (draggedDeal && eventDealId === draggedDeal.deal.id) {
        setDraggedDeal(null)
        setDropTargetStageId('')
        setDealMoveError('Сделка была изменена другим пользователем. Данные обновлены.')
        showCrmToast('Перетаскивание отменено: сделка была изменена')
      }

      setRequestVersion((currentVersion) => currentVersion + 1)
    }

    const handleReconnect = () => {
      setDraggedDeal(null)
      setDropTargetStageId('')
      setRequestVersion((currentVersion) => currentVersion + 1)
    }

    window.addEventListener(CRM_REALTIME_EVENT, handleRealtime)
    window.addEventListener(CRM_REALTIME_RECONNECTED_EVENT, handleReconnect)
    return () => {
      window.removeEventListener(CRM_REALTIME_EVENT, handleRealtime)
      window.removeEventListener(CRM_REALTIME_RECONNECTED_EVENT, handleReconnect)
    }
  }, [draggedDeal])

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
      setPagingByStage((current) => ({
        ...current,
        [createdStage.id]: {
          ...emptyPagingState,
          exhausted: true,
        },
      }))
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

  const handleStageDeleted = () => {
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
            ].slice(0, 20),
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
              ? { ...stage, deal_count: Math.max(0, stage.deal_count - 1) }
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

  const loadMoreDeals = async (stageId: string) => {
    if (contactFilter) {
      return
    }

    const paging = pagingByStage[stageId]
    if (!paging || paging.isLoading || paging.exhausted) {
      return
    }

    setPagingByStage((current) => ({
      ...current,
      [stageId]: {
        ...(current[stageId] ?? emptyPagingState),
        isLoading: true,
        error: '',
      },
    }))

    try {
      let page
      let cursorPrimed = paging.cursorPrimed

      if (!cursorPrimed) {
        const firstPage = await getDealsPage(stageId, 20)
        cursorPrimed = true

        if (!firstPage.has_more || !firstPage.next_cursor) {
          setPagingByStage((current) => ({
            ...current,
            [stageId]: {
              nextCursor: null,
              cursorPrimed: true,
              isLoading: false,
              exhausted: true,
              error: '',
            },
          }))
          return
        }

        page = await getDealsPage(stageId, 20, firstPage.next_cursor)
      } else {
        if (!paging.nextCursor) {
          setPagingByStage((current) => ({
            ...current,
            [stageId]: {
              ...(current[stageId] ?? emptyPagingState),
              isLoading: false,
              exhausted: true,
            },
          }))
          return
        }
        page = await getDealsPage(stageId, 20, paging.nextCursor)
      }

      setState((currentState) => {
        if (!currentState.data) {
          return currentState
        }

        const existingDeals = currentState.data.deals[stageId] ?? []
        const knownIds = new Set(existingDeals.map((deal) => deal.id))
        return {
          ...currentState,
          data: {
            ...currentState.data,
            deals: {
              ...currentState.data.deals,
              [stageId]: [
                ...existingDeals,
                ...page.deals.filter((deal) => !knownIds.has(deal.id)),
              ],
            },
          },
        }
      })

      setPagingByStage((current) => ({
        ...current,
        [stageId]: {
          nextCursor: page.next_cursor,
          cursorPrimed,
          isLoading: false,
          exhausted: !page.has_more || !page.next_cursor,
          error: '',
        },
      }))
    } catch (error) {
      setPagingByStage((current) => ({
        ...current,
        [stageId]: {
          ...(current[stageId] ?? emptyPagingState),
          isLoading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось загрузить следующие сделки.',
        },
      }))
    }
  }

  const handleDealDragStart = (
    event: DragEvent<HTMLElement>,
    deal: ApiKanbanDeal,
    sourceStageId: string,
  ) => {
    if (movingDealId || state.isLoading) {
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
                return { ...stage, deal_count: Math.max(0, stage.deal_count - 1) }
              }
              if (stage.id === targetStageId) {
                return { ...stage, deal_count: stage.deal_count + 1 }
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
      let message =
        error instanceof Error ? error.message : 'Не удалось переместить сделку.'

      if (error instanceof ApiError && error.status === 409) {
        message = 'Сделка была изменена другим пользователем. Данные обновлены.'
      } else if (error instanceof ApiError && error.status === 404) {
        message = 'Сделка была удалена другим пользователем.'
      }

      setDealMoveError(message)
      showCrmToast(message)
      setRequestVersion((currentVersion) => currentVersion + 1)
    } finally {
      setMovingDealId('')
    }
  }

  if (state.isLoading && !state.data) {
    return <DealsSkeleton />
  }

  if (state.error && !state.data) {
    return (
      <section className="deals-state-card" aria-live="polite">
        <h1 className="deals-state-card__title">Не удалось загрузить сделки</h1>
        <p className="deals-state-card__text">
          Не удалось загрузить канбан-доску. Попробуйте обновить страницу.
        </p>
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

  if (!state.data) {
    return null
  }

  const { stages, deals } = state.data
  const systemStageName = stages.find((stage) => stage.is_system)?.name ?? 'Новый лид'
  const filteredDealsCount = Object.values(deals).reduce(
    (total, stageDeals) => total + stageDeals.length,
    0,
  )
  const totalDealCount = stages.reduce((total, stage) => total + stage.deal_count, 0)

  return (
    <>
      <section className="deals-page" aria-label="Сделки">
        {contactFilter && (
          <div className="deals-contact-filter" role="status">
            <div>
              <span>Связанные сделки</span>
              <strong>{contactFilter.name}</strong>
              <small>Найдено: {filteredDealsCount}</small>
            </div>
            <button
              type="button"
              onClick={() => {
                window.history.replaceState(null, '', '/app/deals')
                setContactFilter(null)
              }}
            >
              Показать все сделки
            </button>
          </div>
        )}

        {state.isLoading && (
          <div className="deals-page__refreshing" role="status">
            Обновляем канбан…
          </div>
        )}

        {state.error && (
          <p className="deals-page__error" role="alert">
            Не удалось синхронизировать канбан. Будет выполнена следующая попытка обновления.
          </p>
        )}

        {dealMoveError && (
          <p className="deals-page__error" role="alert">
            {dealMoveError}
          </p>
        )}

        {!contactFilter && totalDealCount === 0 && (
          <p className="deals-board-empty" role="status">
            Сделок пока нет. Создайте первую сделку вручную или дождитесь создания сделки AI.
          </p>
        )}

        <div className="deals-board" aria-label="Воронка сделок">
          {stages.map((stage) => {
            const stageDeals = deals[stage.id] ?? []
            const isDropTarget = dropTargetStageId === stage.id
            const otherStageNames = stages
              .filter((otherStage) => otherStage.id !== stage.id)
              .map((otherStage) => otherStage.name)
            const paging = pagingByStage[stage.id] ?? {
              ...emptyPagingState,
              exhausted: stageDeals.length >= stage.deal_count,
            }

            return (
              <article
                className={`deals-column${isDropTarget ? ' deals-column--drop-target' : ''}`}
                key={stage.id}
                data-stage-id={stage.id}
                onDragOver={(event) => handleStageDragOver(event, stage.id)}
                onDragLeave={(event) => handleStageDragLeave(event, stage.id)}
                onDrop={(event) => handleStageDrop(event, stage.id)}
              >
                <header className="deals-stage">
                  <div className="deals-stage__meta">
                    <span className="deals-stage__title" title={stage.name}>
                      {stage.name}
                    </span>
                    <span className="deals-stage__count">({stage.deal_count})</span>
                  </div>

                  {contactFilter ? null : stage.is_system ? (
                    <button
                      className="deals-stage__action deals-stage__action--add"
                      type="button"
                      aria-label="Добавить сделку"
                      title="Добавить сделку"
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
                      allowDrag={!contactFilter && !state.isLoading}
                      isMoving={movingDealId === deal.id}
                      key={deal.id}
                      onDeleted={(deletedDealId) =>
                        handleDealDeleted(deletedDealId, stage.id)
                      }
                      onDragStart={(event) => handleDealDragStart(event, deal, stage.id)}
                      onDragEnd={handleDealDragEnd}
                    />
                  ))}

                  {!contactFilter && !paging.exhausted && (
                    <LazyLoadSentinel
                      isLoading={paging.isLoading}
                      error={paging.error}
                      onLoad={() => void loadMoreDeals(stage.id)}
                    />
                  )}
                </div>
              </article>
            )
          })}

          {!contactFilter && (
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
          )}
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

type LazyLoadSentinelProps = {
  isLoading: boolean
  error: string
  onLoad: () => void
}

function LazyLoadSentinel({ isLoading, error, onLoad }: LazyLoadSentinelProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isLoading || error || !ref.current || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoad()
        }
      },
      { rootMargin: '180px 0px', threshold: 0.01 },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [error, isLoading, onLoad])

  return (
    <div className="deals-lazy-sentinel" ref={ref}>
      {isLoading ? (
        <span role="status">Загружаем…</span>
      ) : error ? (
        <button type="button" onClick={onLoad}>
          Повторить загрузку
        </button>
      ) : null}
    </div>
  )
}

type DealCardProps = {
  deal: ApiKanbanDeal
  allowDrag: boolean
  isMoving: boolean
  onDeleted: (dealId: string) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

function DealCard({
  deal,
  allowDrag,
  isMoving,
  onDeleted,
  onDragStart,
  onDragEnd,
}: DealCardProps) {
  return (
    <article
      className={`deals-card${isMoving ? ' deals-card--moving' : ''}`}
      data-deal-id={deal.id}
      data-deal-version={deal.version}
      draggable={allowDrag && !isMoving}
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

function createPagingState(data: ApiKanbanResponse, filtered: boolean) {
  return Object.fromEntries(
    data.stages.map((stage) => {
      const loadedCount = data.deals[stage.id]?.length ?? 0
      return [
        stage.id,
        {
          nextCursor: null,
          cursorPrimed: false,
          isLoading: false,
          exhausted: filtered || loadedCount >= stage.deal_count,
          error: '',
        } satisfies StagePagingState,
      ]
    }),
  )
}

function getRealtimeDealId(payload: RealtimePayload | null) {
  if (typeof payload?.deal_id === 'string') {
    return payload.deal_id
  }
  if (typeof payload?.data?.deal_id === 'string') {
    return payload.data.deal_id
  }
  return null
}

function getContactFilterFromLocation(): ContactFilter | null {
  const searchParams = new URLSearchParams(window.location.search)
  const id = searchParams.get('contact_id')?.trim()

  if (!id) {
    return null
  }

  return {
    id,
    name: searchParams.get('contact_name')?.trim() || 'Контакт',
  }
}

async function filterKanbanByContact(
  data: ApiKanbanResponse,
  contactId: string,
  signal?: AbortSignal,
): Promise<ApiKanbanResponse> {
  const stageEntries = await Promise.all(
    data.stages.map(async (stage) => {
      const stageDeals: ApiKanbanDeal[] = []
      let cursor: string | null = null
      let hasMore = true

      while (hasMore) {
        const response = await getDealsPage(stage.id, 20, cursor, signal)
        stageDeals.push(...response.deals)
        cursor = response.next_cursor
        hasMore = response.has_more && Boolean(cursor)
      }

      return [
        stage.id,
        stageDeals.filter((deal) => deal.contact?.id === contactId),
      ] as const
    }),
  )
  const deals = Object.fromEntries(stageEntries)

  return {
    stages: data.stages.map((stage) => ({
      ...stage,
      deal_count: deals[stage.id]?.length ?? 0,
    })),
    deals,
  }
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
  const currencySymbols: Record<string, string> = {
    RUB: '₽',
    USD: '$',
    EUR: '€',
  }
  const currency = currencySymbols[deal.currency] ?? deal.currency
  return `${formattedAmount} ${currency}`
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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
