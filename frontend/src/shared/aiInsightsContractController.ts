import './aiInsightsContractController.css'

type InsightRecord = Record<string, unknown>
type CapturedInsights = {
  id: string
  insights: InsightRecord
  capturedAt: number
}

const CONTACT_DETAIL_PATH = /^\/api\/contacts\/([0-9a-f-]+)\/?$/i
const DEAL_DETAIL_PATH = /^\/api\/crm\/deals\/([0-9a-f-]+)\/?$/i
const MAX_CAPTURE_AGE_MS = 30_000
const TAB_ATTRIBUTE = 'data-ai-insights-tabs'
const PANEL_ATTRIBUTE = 'data-ai-insights-panel'

let installed = false
let observer: MutationObserver | null = null
let latestContact: CapturedInsights | null = null
let latestDeal: CapturedInsights | null = null

export function installAiInsightsContractController() {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return
  installed = true

  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init)
    captureInsights(input, init, response)
    return response
  }

  const start = () => {
    normalizeOpenCards()
    observer = new MutationObserver(() => normalizeOpenCards())
    observer.observe(document.body, { childList: true, subtree: true })
  }

  if (document.body) start()
  else window.addEventListener('DOMContentLoaded', start, { once: true })
}

function captureInsights(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  response: Response,
) {
  if (!response.ok) return

  const requestMethod = (
    init?.method
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
  ).toUpperCase()
  if (requestMethod === 'DELETE') return

  const rawUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url
  const pathname = new URL(rawUrl, window.location.origin).pathname
  const contactMatch = pathname.match(CONTACT_DETAIL_PATH)
  const dealMatch = pathname.match(DEAL_DETAIL_PATH)
  if (!contactMatch && !dealMatch) return

  // Invalidate the previous card immediately. Parsing the cloned response is
  // asynchronous and must never leave stale insights visible during the gap.
  if (contactMatch) latestContact = null
  if (dealMatch) latestDeal = null
  normalizeOpenCards()

  void response.clone().json().then((payload: unknown) => {
    if (!isRecord(payload) || typeof payload.id !== 'string') return
    const capture: CapturedInsights = {
      id: payload.id,
      insights: isRecord(payload.ai_insights) ? payload.ai_insights : {},
      capturedAt: Date.now(),
    }

    if (contactMatch && payload.id.toLowerCase() === contactMatch[1].toLowerCase()) {
      latestContact = capture
    } else if (dealMatch && payload.id.toLowerCase() === dealMatch[1].toLowerCase()) {
      latestDeal = capture
    }
    normalizeOpenCards()
  }).catch(() => undefined)
}

function normalizeOpenCards() {
  normalizeContactCard()
  normalizeDealCard()
}

function normalizeContactCard() {
  const modal = document.querySelector<HTMLElement>('.contact-card-modal')
  if (!modal) {
    latestContact = null
    return
  }
  const nativeView = modal.querySelector<HTMLElement>('.contact-card-modal__view')
  if (!nativeView) {
    cleanupCard(modal)
    return
  }
  const capture = validCapture(latestContact)
  if (!capture) return
  ensureTabs(modal, nativeView, capture, 'contact')
}

function normalizeDealCard() {
  const modal = document.querySelector<HTMLElement>('.deal-detail-modal')
  if (!modal) {
    latestDeal = null
    return
  }
  const nativeView = modal.querySelector<HTMLElement>('.deal-detail-modal__body')
  if (!nativeView || !nativeView.querySelector('.deal-detail-modal__view-footer')) {
    cleanupCard(modal)
    return
  }
  const capture = validCapture(latestDeal)
  if (!capture) return
  ensureTabs(modal, nativeView, capture, 'deal')
}

function ensureTabs(
  modal: HTMLElement,
  nativeView: HTMLElement,
  capture: CapturedInsights,
  kind: 'contact' | 'deal',
) {
  let tabs = modal.querySelector<HTMLElement>(`[${TAB_ATTRIBUTE}]`)
  let panel = modal.querySelector<HTMLElement>(`[${PANEL_ATTRIBUTE}]`)

  if (!tabs || !panel) {
    tabs = createTabs(nativeView)
    panel = document.createElement('section')
    panel.className = 'ai-insights-panel'
    panel.setAttribute(PANEL_ATTRIBUTE, kind)
    panel.id = tabs.dataset.aiInsightsPanelId || ''
    panel.hidden = true
    panel.setAttribute('aria-label', 'AI-аналитика')
    nativeView.before(tabs)
    nativeView.after(panel)
  }

  tabs.setAttribute('data-ai-insights-object-id', capture.id)
  panel.setAttribute('data-ai-insights-object-id', capture.id)
  const signature = insightSignature(capture.insights)
  if (panel.dataset.aiInsightsSignature !== signature) {
    renderInsights(panel, capture.insights)
    panel.dataset.aiInsightsSignature = signature
  }
}

function createTabs(nativeView: HTMLElement) {
  const tabs = document.createElement('div')
  tabs.className = 'ai-insights-tabs'
  tabs.setAttribute(TAB_ATTRIBUTE, 'true')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Разделы карточки')

  const detailsButton = createTabButton('Основное', true)
  const insightsButton = createTabButton('AI-аналитика', false)
  const panelId = `ai-insights-${Math.random().toString(36).slice(2)}`
  tabs.dataset.aiInsightsPanelId = panelId
  insightsButton.setAttribute('aria-controls', panelId)

  detailsButton.addEventListener('click', () => {
    nativeView.hidden = false
    const panel = tabs.parentElement?.querySelector<HTMLElement>(`[${PANEL_ATTRIBUTE}]`)
    if (panel) panel.hidden = true
    setSelectedTab(detailsButton, insightsButton)
  })

  insightsButton.addEventListener('click', () => {
    nativeView.hidden = true
    const panel = tabs.parentElement?.querySelector<HTMLElement>(`[${PANEL_ATTRIBUTE}]`)
    if (panel) panel.hidden = false
    setSelectedTab(insightsButton, detailsButton)
  })

  tabs.append(detailsButton, insightsButton)
  return tabs
}

function createTabButton(label: string, selected: boolean) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `ai-insights-tab${selected ? ' is-active' : ''}`
  button.textContent = label
  button.setAttribute('role', 'tab')
  button.setAttribute('aria-selected', String(selected))
  return button
}

function setSelectedTab(selected: HTMLButtonElement, other: HTMLButtonElement) {
  selected.classList.add('is-active')
  selected.setAttribute('aria-selected', 'true')
  other.classList.remove('is-active')
  other.setAttribute('aria-selected', 'false')
}

function renderInsights(panel: HTMLElement, insights: InsightRecord) {
  panel.replaceChildren()
  const hasContent = Object.values(insights).some((value) => hasValue(value))
  if (!hasContent) {
    const empty = document.createElement('p')
    empty.className = 'ai-insights-empty'
    empty.textContent = 'AI-аналитика пока не сформирована.'
    panel.append(empty)
    return
  }

  const grid = document.createElement('dl')
  grid.className = 'ai-insights-grid'
  const rows: Array<[string, string]> = [
    ['Потребности', formatValue(insights.needs)],
    ['Бюджет', formatValue(insights.budget)],
    ['Сроки', formatValue(insights.timeline)],
    ['Возражения', formatValue(insights.objections)],
    ['Следующий шаг', formatValue(insights.next_step)],
    ['Вероятность', formatPercent(insights.probability, false)],
    ['Уверенность', formatPercent(insights.confidence, true)],
    ['Последний анализ', formatDateTime(insights.last_analyzed_at)],
  ]

  rows.forEach(([label, value]) => {
    const item = document.createElement('div')
    item.className = 'ai-insights-row'
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = label
    description.textContent = value
    item.append(term, description)
    grid.append(item)
  })
  panel.append(grid)
}

function cleanupCard(modal: HTMLElement) {
  modal.querySelector(`[${TAB_ATTRIBUTE}]`)?.remove()
  modal.querySelector(`[${PANEL_ATTRIBUTE}]`)?.remove()
  const hidden = modal.querySelector<HTMLElement>(
    '[hidden].contact-card-modal__view, [hidden].deal-detail-modal__body',
  )
  if (hidden) hidden.hidden = false
}

function validCapture(capture: CapturedInsights | null) {
  if (!capture || Date.now() - capture.capturedAt > MAX_CAPTURE_AGE_MS) return null
  return capture
}

function insightSignature(insights: InsightRecord) {
  try {
    return JSON.stringify(insights)
  } catch {
    return String(Date.now())
  }
}

function formatValue(value: unknown) {
  if (!hasValue(value)) return '—'
  if (Array.isArray(value)) {
    const values = value.map((item) => formatValue(item)).filter((item) => item !== '—')
    return values.length ? values.join(', ') : '—'
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${formatValue(item)}`)
      .join('; ') || '—'
  }
  return String(value)
}

function formatPercent(value: unknown, ratio: boolean) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return '—'
  const percent = ratio && number <= 1 ? number * 100 : number
  return `${Math.round(Math.max(0, Math.min(100, percent)))}%`
}

function formatDateTime(value: unknown) {
  if (typeof value !== 'string' || !value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false
  if (Array.isArray(value)) return value.some((item) => hasValue(item))
  if (isRecord(value)) return Object.values(value).some((item) => hasValue(item))
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
