import { ApiError } from './api/apiClient'
import {
  getDealsPage,
  getKanban,
  moveDeal,
  type ApiKanbanDeal,
  type ApiSalesStage,
} from './api/dealsApi'
import { CRM_REALTIME_EVENT } from './crmRealtime'
import { showCrmToast } from './crmToast'

const LONG_PRESS_MS = 280
const MOVE_CANCEL_DISTANCE_PX = 12
const CACHE_TTL_MS = 5_000
const AUTO_SCROLL_EDGE_PX = 52
const AUTO_SCROLL_STEP_PX = 22

const DEAL_EVENTS = new Set([
  'deal_created',
  'deal_updated',
  'deal_stage_changed',
  'deals_stage_changed_batch',
  'deal_deleted',
  'stage_created',
  'stage_updated',
  'stage_deleted',
])

type CachedStage = {
  stage: ApiSalesStage
  deals: ApiKanbanDeal[]
  nextCursor: string | null
  cursorPrimed: boolean
  exhausted: boolean
}

type BoardCache = {
  loadedAt: number
  stages: CachedStage[]
}

type TouchDragState = {
  pointerId: number
  card: HTMLElement
  sourceStageIndex: number
  cardIndex: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  longPressTimer: number | null
  active: boolean
  targetStageIndex: number | null
  deal: ApiKanbanDeal | null
  dealPromise: Promise<ApiKanbanDeal | null>
  ghost: HTMLElement | null
  previousUserSelect: string
}

type RealtimePayload = {
  event?: unknown
  deal_id?: unknown
  data?: {
    deal_id?: unknown
  }
  local?: unknown
}

let installed = false
let boardCache: BoardCache | null = null
let boardCachePromise: Promise<BoardCache> | null = null
let dragState: TouchDragState | null = null
let suppressClickUntil = 0

export function installDealsTouchDnd() {
  if (installed || typeof document === 'undefined') {
    return
  }

  installed = true

  document.addEventListener('pointerdown', handlePointerDown, true)
  document.addEventListener('pointermove', handlePointerMove, {
    capture: true,
    passive: false,
  })
  document.addEventListener('pointerup', handlePointerUp, true)
  document.addEventListener('pointercancel', handlePointerCancel, true)
  document.addEventListener('click', handleClickCapture, true)
  window.addEventListener(CRM_REALTIME_EVENT, handleRealtimeEvent)
}

function handlePointerDown(event: PointerEvent) {
  if (
    window.location.pathname !== '/app/deals' ||
    document.querySelector('.deals-contact-filter') ||
    (event.pointerType !== 'touch' && event.pointerType !== 'pen') ||
    event.button !== 0 ||
    !event.isPrimary ||
    dragState
  ) {
    return
  }

  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  if (target.closest('button, input, a, select, textarea, .deal-card-menu')) {
    return
  }

  const card = target.closest<HTMLElement>('.deals-card')
  if (!card || card.classList.contains('deals-card--moving')) {
    return
  }

  const sourceStageIndex = getStageIndex(card)
  const cardIndex = getCardIndex(card)
  if (sourceStageIndex < 0 || cardIndex < 0) {
    return
  }

  const state: TouchDragState = {
    pointerId: event.pointerId,
    card,
    sourceStageIndex,
    cardIndex,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    longPressTimer: null,
    active: false,
    targetStageIndex: null,
    deal: null,
    dealPromise: Promise.resolve(null),
    ghost: null,
    previousUserSelect: document.body.style.userSelect,
  }

  state.dealPromise = resolveDealForCard(card, sourceStageIndex, cardIndex)
  state.longPressTimer = window.setTimeout(() => {
    state.longPressTimer = null
    void activateTouchDrag(state)
  }, LONG_PRESS_MS)
  dragState = state
}

function handlePointerMove(event: PointerEvent) {
  const state = dragState
  if (!state || state.pointerId !== event.pointerId) {
    return
  }

  state.currentX = event.clientX
  state.currentY = event.clientY

  if (!state.active) {
    const distance = Math.hypot(
      event.clientX - state.startX,
      event.clientY - state.startY,
    )

    if (distance > MOVE_CANCEL_DISTANCE_PX) {
      clearLongPressTimer(state)
      dragState = null
    }
    return
  }

  event.preventDefault()
  moveGhost(state)
  autoScrollBoard(event.clientX)
  updateDropTarget(state, event.clientX, event.clientY)
}

function handlePointerUp(event: PointerEvent) {
  const state = dragState
  if (!state || state.pointerId !== event.pointerId) {
    return
  }

  clearLongPressTimer(state)

  if (!state.active) {
    dragState = null
    return
  }

  event.preventDefault()
  suppressClickUntil = Date.now() + 600

  const targetStageIndex = state.targetStageIndex
  const deal = state.deal
  finishVisualDrag(state, true)
  dragState = null

  if (
    !deal ||
    targetStageIndex === null ||
    targetStageIndex === state.sourceStageIndex
  ) {
    state.card.classList.remove('deals-card--moving')
    return
  }

  void moveDealByTouch(state.card, deal, targetStageIndex)
}

function handlePointerCancel(event: PointerEvent) {
  const state = dragState
  if (!state || state.pointerId !== event.pointerId) {
    return
  }

  clearLongPressTimer(state)
  finishVisualDrag(state, false)
  dragState = null
}

function handleClickCapture(event: MouseEvent) {
  if (Date.now() >= suppressClickUntil) {
    return
  }

  if (event.target instanceof Element && event.target.closest('.deals-card')) {
    event.preventDefault()
    event.stopPropagation()
  }
}

async function activateTouchDrag(state: TouchDragState) {
  const deal = await state.dealPromise

  if (dragState !== state || state.active) {
    return
  }

  if (!deal) {
    showCrmToast('Не удалось определить сделку для перемещения.')
    dragState = null
    return
  }

  state.deal = deal
  state.active = true
  state.card.classList.add('deals-card--moving')
  document.body.style.userSelect = 'none'
  state.ghost = createGhost(state.card, state.currentX, state.currentY)

  try {
    state.card.setPointerCapture(state.pointerId)
  } catch {
    // Pointer capture is an enhancement; document listeners still keep DnD usable.
  }

  moveGhost(state)
  updateDropTarget(state, state.currentX, state.currentY)

  if (navigator.vibrate) {
    navigator.vibrate(25)
  }
}

async function moveDealByTouch(
  card: HTMLElement,
  deal: ApiKanbanDeal,
  targetStageIndex: number,
) {
  try {
    const cache = await getBoardCache()
    const targetStage = cache.stages[targetStageIndex]?.stage

    if (!targetStage) {
      throw new Error('Не удалось определить этап для перемещения сделки.')
    }

    await moveDeal(deal.id, {
      stage_id: targetStage.id,
      version: deal.version,
    })

    invalidateBoardCache()
    requestDealsRefresh(deal.id)
  } catch (error) {
    invalidateBoardCache()

    if (error instanceof ApiError && error.status === 409) {
      showCrmToast('Сделка была изменена другим пользователем. Обновите данные.')
    } else if (error instanceof ApiError && error.status === 404) {
      showCrmToast('Сделка была удалена другим пользователем.')
    } else {
      showCrmToast(
        error instanceof Error
          ? error.message
          : 'Не удалось переместить сделку.',
      )
    }

    requestDealsRefresh(deal.id)
  } finally {
    card.classList.remove('deals-card--moving')
  }
}

function requestDealsRefresh(dealId: string) {
  window.dispatchEvent(
    new CustomEvent(CRM_REALTIME_EVENT, {
      detail: {
        event: 'deal_stage_changed',
        deal_id: dealId,
        local: true,
      },
    }),
  )
}

function handleRealtimeEvent(event: Event) {
  if (!(event instanceof CustomEvent)) {
    return
  }

  const payload = event.detail as RealtimePayload | null
  const eventName = typeof payload?.event === 'string' ? payload.event : ''
  if (!DEAL_EVENTS.has(eventName)) {
    return
  }

  invalidateBoardCache()

  const state = dragState
  if (!state?.active || !state.deal || payload?.local === true) {
    return
  }

  const dealId = getRealtimeDealId(payload)
  if (!dealId || dealId !== state.deal.id) {
    return
  }

  const deleted = eventName === 'deal_deleted'
  cancelActiveDrag(state)
  showCrmToast(
    deleted
      ? 'Сделка была удалена другим пользователем.'
      : 'Сделка была изменена другим пользователем. Обновите данные.',
  )
}

function cancelActiveDrag(state: TouchDragState) {
  suppressClickUntil = Date.now() + 600
  finishVisualDrag(state, false)
  dragState = null
}

function createGhost(card: HTMLElement, x: number, y: number) {
  const rect = card.getBoundingClientRect()
  const ghost = card.cloneNode(true) as HTMLElement

  ghost.removeAttribute('draggable')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.classList.remove('deals-card--moving')
  ghost.querySelector('.deal-card-menu')?.remove()

  Object.assign(ghost.style, {
    position: 'fixed',
    zIndex: '10000',
    width: `${rect.width}px`,
    margin: '0',
    left: `${x}px`,
    top: `${y}px`,
    transform: 'translate(-50%, -50%) scale(0.98)',
    pointerEvents: 'none',
    opacity: '0.92',
    boxShadow: '0 18px 42px rgba(11, 43, 85, 0.24)',
  })

  document.body.appendChild(ghost)
  return ghost
}

function moveGhost(state: TouchDragState) {
  if (!state.ghost) {
    return
  }

  state.ghost.style.left = `${state.currentX}px`
  state.ghost.style.top = `${state.currentY}px`
}

function updateDropTarget(state: TouchDragState, x: number, y: number) {
  const element = document.elementsFromPoint(x, y).find((candidate) =>
    candidate.closest('.deals-column:not(.deals-column--add-stage)'),
  )
  const targetStageIndex = element ? getStageIndex(element) : -1

  clearDropTargetClasses()
  state.targetStageIndex =
    targetStageIndex >= 0 && targetStageIndex !== state.sourceStageIndex
      ? targetStageIndex
      : null

  if (state.targetStageIndex !== null) {
    getStageColumns()[state.targetStageIndex]?.classList.add(
      'deals-column--drop-target',
    )
  }
}

function finishVisualDrag(state: TouchDragState, keepMovingClass: boolean) {
  clearLongPressTimer(state)
  clearDropTargetClasses()
  state.ghost?.remove()
  state.ghost = null
  document.body.style.userSelect = state.previousUserSelect

  try {
    if (state.card.hasPointerCapture(state.pointerId)) {
      state.card.releasePointerCapture(state.pointerId)
    }
  } catch {
    // Ignore browsers that do not support pointer capture for this input source.
  }

  if (!keepMovingClass) {
    state.card.classList.remove('deals-card--moving')
  }
}

function clearDropTargetClasses() {
  document
    .querySelectorAll('.deals-column--drop-target')
    .forEach((element) => element.classList.remove('deals-column--drop-target'))
}

function clearLongPressTimer(state: TouchDragState) {
  if (state.longPressTimer !== null) {
    window.clearTimeout(state.longPressTimer)
    state.longPressTimer = null
  }
}

function autoScrollBoard(clientX: number) {
  const scroller = document.querySelector<HTMLElement>('.deals-page')
  if (!scroller) {
    return
  }

  const rect = scroller.getBoundingClientRect()

  if (clientX < rect.left + AUTO_SCROLL_EDGE_PX) {
    scroller.scrollLeft -= AUTO_SCROLL_STEP_PX
  } else if (clientX > rect.right - AUTO_SCROLL_EDGE_PX) {
    scroller.scrollLeft += AUTO_SCROLL_STEP_PX
  }
}

function getStageColumns() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.deals-board > .deals-column:not(.deals-column--add-stage)',
    ),
  )
}

function getStageIndex(element: Element) {
  const column = element.closest<HTMLElement>(
    '.deals-column:not(.deals-column--add-stage)',
  )
  if (!column) {
    return -1
  }

  return getStageColumns().indexOf(column)
}

function getCardIndex(card: HTMLElement) {
  const cardsContainer = card.closest('.deals-column__cards')
  if (!cardsContainer) {
    return -1
  }

  return Array.from(
    cardsContainer.querySelectorAll<HTMLElement>(':scope > .deals-card'),
  ).indexOf(card)
}

async function resolveDealForCard(
  card: HTMLElement,
  stageIndex: number,
  cardIndex: number,
) {
  let deal = await getDealAt(stageIndex, cardIndex)
  const title = card.querySelector('.deals-card__title')?.textContent?.trim() ?? ''

  if (deal && (!title || deal.name === title)) {
    return deal
  }

  invalidateBoardCache()
  deal = await getDealAt(stageIndex, cardIndex)

  if (deal && (!title || deal.name === title)) {
    return deal
  }

  return null
}

async function getDealAt(stageIndex: number, index: number) {
  const cache = await getBoardCache()
  const cachedStage = cache.stages[stageIndex]
  if (!cachedStage) {
    return null
  }

  while (cachedStage.deals.length <= index && !cachedStage.exhausted) {
    if (!cachedStage.cursorPrimed) {
      const firstPage = await getDealsPage(cachedStage.stage.id, 20)
      mergeDeals(cachedStage.deals, firstPage.deals)
      cachedStage.cursorPrimed = true
      cachedStage.nextCursor = firstPage.next_cursor
      cachedStage.exhausted = !firstPage.has_more || !firstPage.next_cursor
      continue
    }

    if (!cachedStage.nextCursor) {
      cachedStage.exhausted = true
      break
    }

    const page = await getDealsPage(
      cachedStage.stage.id,
      20,
      cachedStage.nextCursor,
    )
    mergeDeals(cachedStage.deals, page.deals)
    cachedStage.nextCursor = page.next_cursor
    cachedStage.exhausted = !page.has_more || !page.next_cursor
  }

  return cachedStage.deals[index] ?? null
}

function mergeDeals(target: ApiKanbanDeal[], incoming: ApiKanbanDeal[]) {
  const knownIds = new Set(target.map((deal) => deal.id))
  target.push(...incoming.filter((deal) => !knownIds.has(deal.id)))
}

async function getBoardCache() {
  if (boardCache && Date.now() - boardCache.loadedAt <= CACHE_TTL_MS) {
    return boardCache
  }

  if (!boardCachePromise) {
    boardCachePromise = loadBoardCache().finally(() => {
      boardCachePromise = null
    })
  }

  boardCache = await boardCachePromise
  return boardCache
}

async function loadBoardCache(): Promise<BoardCache> {
  const kanban = await getKanban()

  return {
    loadedAt: Date.now(),
    stages: kanban.stages.map((stage) => {
      const deals = [...(kanban.deals[stage.id] ?? [])]
      return {
        stage,
        deals,
        nextCursor: null,
        cursorPrimed: false,
        exhausted: stage.deal_count <= deals.length,
      }
    }),
  }
}

function invalidateBoardCache() {
  boardCache = null
}

function getRealtimeDealId(payload: RealtimePayload | null) {
  if (typeof payload?.deal_id === 'string') {
    return payload.deal_id
  }

  return typeof payload?.data?.deal_id === 'string'
    ? payload.data.deal_id
    : ''
}
