import { CRM_REALTIME_EVENT } from './crmRealtime'

const STALE_DEAL_CONFLICT =
  'Сделка была изменена другим пользователем. Данные обновлены.'
const CURRENT_DEAL_CONFLICT =
  'Сделка была изменена другим пользователем. Обновите данные.'
const CONTRACT_MESSENGER_ATTRIBUTE = 'data-deals-contract-messenger'

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

  const createTitle = root instanceof Element && root.matches('#create-deal-title')
    ? root
    : root.querySelector<HTMLElement>('#create-deal-title')
  if (createTitle?.textContent?.trim() === 'Добавление сделки') {
    createTitle.textContent = 'Создать сделку'
  }

  const createButton = root instanceof Element && root.matches('.create-deal-form__submit')
    ? root
    : root.querySelector<HTMLElement>('.create-deal-form__submit')
  if (createButton?.textContent?.trim() === 'Добавить сделку') {
    createButton.textContent = 'Создать сделку'
  }

  const fieldErrors = root instanceof Element && root.matches('.create-deal-v2__field-error')
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>('.create-deal-v2__field-error'))
  fieldErrors.forEach((error) => {
    const message = error.textContent?.trim()
    if (message === 'Название сделки обязательно') {
      error.textContent = 'Обязательное поле'
    } else if (message === 'ФИО контакта обязательно') {
      error.textContent = 'ФИО обязательно'
    }
  })

  ensureMessengerActions(root)
}

function ensureMessengerActions(root: ParentNode) {
  const createBlocks = root instanceof Element && root.matches('.create-deal-form__messenger-block')
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>('.create-deal-form__messenger-block'))

  createBlocks.forEach((block) => {
    const injected = block.querySelector<HTMLButtonElement>(
      `.create-deal-form__messenger-button[${CONTRACT_MESSENGER_ATTRIBUTE}]`,
    )
    const native = block.querySelector<HTMLButtonElement>(
      `.create-deal-form__messenger-button:not([${CONTRACT_MESSENGER_ATTRIBUTE}])`,
    )

    if (native) {
      injected?.remove()
      return
    }

    if (!injected) {
      block.prepend(createDisabledMessengerButton('create-deal-form__messenger-button'))
    }
  })

  const dealContents = root instanceof Element && root.matches('.deal-detail-modal__content')
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>('.deal-detail-modal__content'))

  dealContents.forEach((content) => {
    const injected = content.querySelector<HTMLButtonElement>(
      `.deal-detail-modal__messenger[${CONTRACT_MESSENGER_ATTRIBUTE}]`,
    )
    const native = content.querySelector<HTMLButtonElement>(
      `.deal-detail-modal__messenger:not([${CONTRACT_MESSENGER_ATTRIBUTE}])`,
    )

    if (native) {
      injected?.remove()
      return
    }

    if (injected) return

    const divider = content.querySelector<HTMLElement>('.deal-detail-modal__divider')
    if (!divider) return
    divider.before(createDisabledMessengerButton('deal-detail-modal__messenger'))
  })
}

function createDisabledMessengerButton(className: string) {
  const button = document.createElement('button')
  button.className = className
  button.type = 'button'
  button.disabled = true
  button.textContent = 'Добавить мессенджер'
  button.setAttribute(CONTRACT_MESSENGER_ATTRIBUTE, 'true')
  return button
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
