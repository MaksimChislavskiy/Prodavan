const PENDING_AI_QUERY_KEY = 'pending_ai_query'
const PENDING_AI_QUERY_PROMPT = 'У вас есть неотправленный запрос. Отправить сейчас?'

let isControllerInstalled = false
let isOfferRequested = true

export function rememberPendingAiQuery(query: string) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return
  }

  window.localStorage.setItem(PENDING_AI_QUERY_KEY, normalizedQuery)
}

export function readPendingAiQuery() {
  return window.localStorage.getItem(PENDING_AI_QUERY_KEY)?.trim() ?? ''
}

export function clearPendingAiQuery(expectedQuery?: string) {
  if (expectedQuery !== undefined) {
    const current = readPendingAiQuery()
    if (current && current !== expectedQuery.trim()) {
      return
    }
  }

  window.localStorage.removeItem(PENDING_AI_QUERY_KEY)
}

export function installPendingAiQueryController() {
  if (isControllerInstalled) {
    return
  }
  isControllerInstalled = true

  const rememberTopBarSubmission = (event: Event) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement) || !form.matches('.crm-ai-search')) {
      return
    }

    const input = form.querySelector<HTMLInputElement>('.crm-ai-search__input')
    if (input) {
      rememberPendingAiQuery(input.value)
    }
  }

  const tryOfferPendingQuery = () => {
    if (!isOfferRequested || !navigator.onLine) {
      return false
    }

    const query = readPendingAiQuery()
    if (!query) {
      isOfferRequested = false
      return true
    }

    const modalForm = document.querySelector<HTMLFormElement>('form.ai-assistant-input-row')
    const modalTextarea = modalForm?.querySelector<HTMLTextAreaElement>('textarea') ?? null
    const topBarForm = document.querySelector<HTMLFormElement>('form.crm-ai-search')
    const topBarInput = topBarForm?.querySelector<HTMLInputElement>('.crm-ai-search__input') ?? null

    if ((!modalForm || !modalTextarea) && (!topBarForm || !topBarInput)) {
      return false
    }

    isOfferRequested = false
    if (!window.confirm(PENDING_AI_QUERY_PROMPT)) {
      clearPendingAiQuery(query)
      return true
    }

    if (modalForm && modalTextarea) {
      setReactTextareaValue(modalTextarea, query)
      window.setTimeout(() => modalForm.requestSubmit(), 0)
      return true
    }

    if (topBarForm && topBarInput) {
      setReactInputValue(topBarInput, query)
      window.setTimeout(() => topBarForm.requestSubmit(), 0)
    }
    return true
  }

  const requestOffer = () => {
    isOfferRequested = true
    void tryOfferPendingQuery()
  }

  document.addEventListener('submit', rememberTopBarSubmission, true)
  window.addEventListener('online', requestOffer)

  const observer = new MutationObserver(() => {
    void tryOfferPendingQuery()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  window.setTimeout(() => {
    void tryOfferPendingQuery()
  }, 0)
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set

  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function setReactTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set

  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
