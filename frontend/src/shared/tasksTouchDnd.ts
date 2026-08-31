import { ApiError } from './api/apiClient'
import {
  getTasksKanban,
  getTasksPage,
  updateTaskStatus,
  type ApiTask,
  type TaskStatus,
} from './api/tasksApi'
import { CRM_REALTIME_EVENT } from './crmRealtime'

const LONG_PRESS_MS = 280
const MOVE_CANCEL_DISTANCE_PX = 12
const CACHE_TTL_MS = 5_000
const AUTO_SCROLL_EDGE_PX = 52
const AUTO_SCROLL_STEP_PX = 22

const taskStatuses: TaskStatus[] = ['new', 'in_progress', 'done']
const taskStatusLabels: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Выполнена',
}

type CachedColumn = {
  tasks: ApiTask[]
  nextCursor: string | null
}

type BoardCache = {
  loadedAt: number
  columns: Record<TaskStatus, CachedColumn>
}

type TouchDragState = {
  pointerId: number
  card: HTMLElement
  sourceStatus: TaskStatus
  cardIndex: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  longPressTimer: number | null
  active: boolean
  targetStatus: TaskStatus | null
  task: ApiTask | null
  taskPromise: Promise<ApiTask | null>
  ghost: HTMLElement | null
  previousUserSelect: string
}

let installed = false
let boardCache: BoardCache | null = null
let boardCachePromise: Promise<BoardCache> | null = null
let dragState: TouchDragState | null = null
let suppressClickUntil = 0
let toastTimer: number | null = null

export function installTasksTouchDnd() {
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
  window.addEventListener(CRM_REALTIME_EVENT, invalidateBoardCache)
}

function handlePointerDown(event: PointerEvent) {
  if (
    window.location.pathname !== '/app/tasks' ||
    (event.pointerType !== 'touch' && event.pointerType !== 'pen') ||
    event.button !== 0 ||
    dragState
  ) {
    return
  }

  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  if (target.closest('button, input, a, select, textarea')) {
    return
  }

  const card = target.closest<HTMLElement>('.tasks-card')
  if (!card || card.classList.contains('tasks-card--moving')) {
    return
  }

  const sourceStatus = getColumnStatus(card)
  if (!sourceStatus) {
    return
  }

  const cardIndex = getCardIndex(card)
  if (cardIndex < 0) {
    return
  }

  const state: TouchDragState = {
    pointerId: event.pointerId,
    card,
    sourceStatus,
    cardIndex,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    longPressTimer: null,
    active: false,
    targetStatus: null,
    task: null,
    taskPromise: Promise.resolve(null),
    ghost: null,
    previousUserSelect: document.body.style.userSelect,
  }

  state.taskPromise = resolveTaskForCard(card, sourceStatus, cardIndex)
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

  const targetStatus = state.targetStatus
  const task = state.task
  finishVisualDrag(state, true)
  dragState = null

  if (!task || !targetStatus || targetStatus === state.sourceStatus) {
    state.card.classList.remove('tasks-card--moving')
    return
  }

  void moveTaskByTouch(state.card, task, targetStatus)
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

  if (event.target instanceof Element && event.target.closest('.tasks-card')) {
    event.preventDefault()
    event.stopPropagation()
  }
}

async function activateTouchDrag(state: TouchDragState) {
  const task = await state.taskPromise

  if (dragState !== state || state.active) {
    return
  }

  if (!task) {
    showTouchToast('Не удалось определить задачу для перемещения.')
    dragState = null
    return
  }

  state.task = task
  state.active = true
  state.card.classList.add('tasks-card--moving')
  document.body.style.userSelect = 'none'
  state.ghost = createGhost(state.card, state.currentX, state.currentY)
  moveGhost(state)
  updateDropTarget(state, state.currentX, state.currentY)

  if (navigator.vibrate) {
    navigator.vibrate(25)
  }
}

async function moveTaskByTouch(
  card: HTMLElement,
  task: ApiTask,
  targetStatus: TaskStatus,
) {
  try {
    await updateTaskStatus(task.id, targetStatus, task.version)
    invalidateBoardCache()
    showTouchToast(
      `Задача перенесена в колонку «${taskStatusLabels[targetStatus]}».`,
    )
    requestTasksRefresh()
  } catch (error) {
    invalidateBoardCache()

    if (error instanceof ApiError && error.status === 409) {
      showTouchToast('Задача была изменена другим пользователем. Обновите данные.')
    } else if (error instanceof ApiError && error.status === 404) {
      showTouchToast('Задача не найдена или уже удалена.')
    } else {
      showTouchToast(
        error instanceof Error
          ? error.message
          : 'Не удалось изменить статус задачи.',
      )
    }

    requestTasksRefresh()
  } finally {
    card.classList.remove('tasks-card--moving')
  }
}

function requestTasksRefresh() {
  window.dispatchEvent(
    new CustomEvent(CRM_REALTIME_EVENT, {
      detail: {
        event: 'task_updated',
        local: true,
      },
    }),
  )
}

function createGhost(card: HTMLElement, x: number, y: number) {
  const rect = card.getBoundingClientRect()
  const ghost = card.cloneNode(true) as HTMLElement

  ghost.removeAttribute('draggable')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.classList.remove('tasks-card--moving')
  Object.assign(ghost.style, {
    position: 'fixed',
    zIndex: '10000',
    width: `${rect.width}px`,
    margin: '0',
    left: `${x}px`,
    top: `${y}px`,
    transform: 'translate(-50%, -50%) scale(0.98)',
    pointerEvents: 'none',
    opacity: '0.9',
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
    candidate.closest('.tasks-column'),
  )
  const targetStatus = element ? getColumnStatus(element) : null

  clearDropTargetClasses()
  state.targetStatus =
    targetStatus && targetStatus !== state.sourceStatus ? targetStatus : null

  if (state.targetStatus) {
    document
      .querySelector<HTMLElement>(`.tasks-column--${state.targetStatus}`)
      ?.classList.add('tasks-column--drop-target')
  }
}

function finishVisualDrag(state: TouchDragState, keepMovingClass: boolean) {
  clearLongPressTimer(state)
  clearDropTargetClasses()
  state.ghost?.remove()
  state.ghost = null
  document.body.style.userSelect = state.previousUserSelect

  if (!keepMovingClass) {
    state.card.classList.remove('tasks-card--moving')
  }
}

function clearDropTargetClasses() {
  document
    .querySelectorAll('.tasks-column--drop-target')
    .forEach((element) => element.classList.remove('tasks-column--drop-target'))
}

function clearLongPressTimer(state: TouchDragState) {
  if (state.longPressTimer !== null) {
    window.clearTimeout(state.longPressTimer)
    state.longPressTimer = null
  }
}

function autoScrollBoard(clientX: number) {
  const board = document.querySelector<HTMLElement>('.tasks-board')
  if (!board) {
    return
  }

  const rect = board.getBoundingClientRect()

  if (clientX < rect.left + AUTO_SCROLL_EDGE_PX) {
    board.scrollLeft -= AUTO_SCROLL_STEP_PX
  } else if (clientX > rect.right - AUTO_SCROLL_EDGE_PX) {
    board.scrollLeft += AUTO_SCROLL_STEP_PX
  }
}

function getColumnStatus(element: Element): TaskStatus | null {
  const column = element.closest('.tasks-column')
  if (!column) {
    return null
  }

  for (const status of taskStatuses) {
    if (column.classList.contains(`tasks-column--${status}`)) {
      return status
    }
  }

  return null
}

function getCardIndex(card: HTMLElement) {
  const column = card.closest('.tasks-column')
  if (!column) {
    return -1
  }

  return Array.from(column.querySelectorAll<HTMLElement>('.tasks-card')).indexOf(card)
}

async function resolveTaskForCard(
  card: HTMLElement,
  status: TaskStatus,
  cardIndex: number,
) {
  let task = await getTaskAt(status, cardIndex)
  const title = card.querySelector('h3')?.textContent?.trim() ?? ''

  if (task && (!title || task.title === title)) {
    return task
  }

  invalidateBoardCache()
  task = await getTaskAt(status, cardIndex)

  if (task && (!title || task.title === title)) {
    return task
  }

  return null
}

async function getTaskAt(status: TaskStatus, index: number) {
  const cache = await getBoardCache()
  const column = cache.columns[status]

  while (column.tasks.length <= index && column.nextCursor) {
    const response = await getTasksPage(status, 50, column.nextCursor)
    const knownIds = new Set(column.tasks.map((task) => task.id))
    column.tasks.push(
      ...response.tasks.filter((task) => !knownIds.has(task.id)),
    )
    column.nextCursor = response.has_more ? response.next_cursor : null
  }

  return column.tasks[index] ?? null
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
  const board = await getTasksKanban(50)

  return {
    loadedAt: Date.now(),
    columns: {
      new: {
        tasks: [...board.new.tasks],
        nextCursor: board.new.next_cursor,
      },
      in_progress: {
        tasks: [...board.in_progress.tasks],
        nextCursor: board.in_progress.next_cursor,
      },
      done: {
        tasks: [...board.done.tasks],
        nextCursor: board.done.next_cursor,
      },
    },
  }
}

function invalidateBoardCache() {
  boardCache = null
}

function showTouchToast(message: string) {
  document.querySelector('.tasks-touch-dnd-toast')?.remove()

  if (toastTimer !== null) {
    window.clearTimeout(toastTimer)
  }

  const toast = document.createElement('div')
  toast.className = 'tasks-toast tasks-touch-dnd-toast'
  toast.setAttribute('role', 'status')

  const icon = document.createElement('span')
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = '↕'

  const text = document.createElement('p')
  text.textContent = message

  toast.append(icon, text)
  document.body.appendChild(toast)

  toastTimer = window.setTimeout(() => {
    toast.remove()
    toastTimer = null
  }, 5_000)
}
