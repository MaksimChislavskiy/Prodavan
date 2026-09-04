import { CRM_REALTIME_EVENT } from './crmRealtime'

const STALE_DEAL_CONFLICT =
  'Сделка была изменена другим пользователем. Данные обновлены.'
const CURRENT_DEAL_CONFLICT =
  'Сделка была изменена другим пользователем. Обновите данные.'

type RealtimePayload = {
  event?: unknown
  deal_id?: unknown
  stage_id?: unknown
  data?: {
    deal_id?: unknown
    stage_id?: unknown
  }
}

let installed = false
let observer: MutationObserver | null = null

export function installDealsContractController() {
  if (installed || typeof document === 'undefined') return
  installed = true

  const start = () => {
    normalizeDealsUi(document)
    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          const parent = record.target.parentElement
          if (parent) normalizeDealsUi(parent)
          continue
        }

        for (const node of record.addedNodes) {
          if (node instanceof Element) normalizeDealsUi(node)
        }
      }
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  if (document.body) start()
  else window.addEventListener('DOMContentLoaded', start, { once: true })

  window.addEventListener(CRM_REALTIME_EVENT, handleRealtime)
}

function normalizeDealsUi(root: ParentNode) {
  const counts = root instanceof Element && root.matches('.deals-stage__count')
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>('.deals-stage__count'))

  counts.forEach((count) => {
    const match = count.textContent?.trim().match(/^\((\d+)\)$/)
    if (match) count.textContent = match[1]
  })

  const errors = root instanceof Element && root.matches('.deals-page__error')
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>('.deals-page__error'))

  errors.forEach((error) => {
    if (error.textContent?.trim() === STALE_DEAL_CONFLICT) {
      error.textContent = CURRENT_DEAL_CONFLICT
    }
  })
}

function handleRealtime(event: Event) {
  if (!(event instanceof CustomEvent)) return
  const payload = event.detail as RealtimePayload | null
  const eventName = typeof payload?.event === 'string' ? payload.event : ''

  if (eventName === 'stage_deleted') {
    const stageId = getStageId(payload)
    if (stageId) hideStageImmediately(stageId)
    return
  }

  if (eventName === 'deal_deleted') {
    const dealId = getDealId(payload)
    if (dealId) hideDealImmediately(dealId)
  }
}

function hideStageImmediately(stageId: string) {
  findByDataAttribute('.deals-column[data-stage-id]', 'stageId', stageId)?.setAttribute(
    'hidden',
    '',
  )
}

function hideDealImmediately(dealId: string) {
  const card = findByDataAttribute('.deals-card[data-deal-id]', 'dealId', dealId)
  if (!card || card.hidden) return

  const column = card.closest<HTMLElement>('.deals-column[data-stage-id]')
  card.hidden = true

  const count = column?.querySelector<HTMLElement>('.deals-stage__count')
  if (!count) return

  const value = Number(count.textContent?.replace(/[()]/g, '').trim())
  if (Number.isFinite(value)) count.textContent = String(Math.max(0, value - 1))
}

function findByDataAttribute(
  selector: string,
  datasetKey: 'stageId' | 'dealId',
  value: string,
) {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (element) => element.dataset[datasetKey] === value,
  ) ?? null
}

function getStageId(payload: RealtimePayload | null) {
  if (typeof payload?.stage_id === 'string') return payload.stage_id
  return typeof payload?.data?.stage_id === 'string' ? payload.data.stage_id : ''
}

function getDealId(payload: RealtimePayload | null) {
  if (typeof payload?.deal_id === 'string') return payload.deal_id
  return typeof payload?.data?.deal_id === 'string' ? payload.data.deal_id : ''
}
