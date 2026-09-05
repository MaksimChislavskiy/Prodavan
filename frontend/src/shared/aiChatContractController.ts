const MAX_AI_MESSAGE_LENGTH = 1000
const EMPTY_ERROR = 'Введите запрос'
const LENGTH_ERROR = 'Максимальная длина запроса — 1000 символов'

let isInstalled = false

export function installAiChatContractController() {
  if (isInstalled) {
    return
  }
  isInstalled = true

  const style = document.createElement('style')
  style.dataset.aiChatContract = 'true'
  style.textContent = `
    .ai-assistant-session-divider{display:none!important}
    .ai-assistant-contract-error{
      margin:-14px 32px 10px;
      color:#e20f0f;
      font-size:12px;
      line-height:16px;
    }
  `
  document.head.appendChild(style)

  const applyContract = () => {
    const title = document.querySelector<HTMLElement>('#ai-assistant-title')
    if (title && title.textContent !== 'AI-помощник') {
      title.textContent = 'AI-помощник'
    }

    const textarea = document.querySelector<HTMLTextAreaElement>(
      '.ai-assistant-input-row textarea',
    )
    if (!textarea) {
      return
    }

    textarea.placeholder = 'Введите сообщение'
    textarea.setAttribute('aria-label', 'Сообщение для AI-помощника')
    textarea.removeAttribute('maxlength')

    if (textarea.dataset.aiChatContractBound === 'true') {
      return
    }
    textarea.dataset.aiChatContractBound = 'true'

    const form = textarea.closest<HTMLFormElement>('form')
    if (!form) {
      return
    }

    const validate = () => {
      const value = textarea.value
      if (!value.trim()) {
        showValidationError(form, EMPTY_ERROR)
        return false
      }
      if (value.length > MAX_AI_MESSAGE_LENGTH) {
        showValidationError(form, LENGTH_ERROR)
        return false
      }

      clearValidationError(form)
      return true
    }

    textarea.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter' || event.shiftKey) {
          return
        }

        if (event.isComposing) {
          event.stopPropagation()
          return
        }

        if (!validate()) {
          event.preventDefault()
          event.stopPropagation()
        }
      },
      true,
    )

    textarea.addEventListener('input', () => {
      const currentError = form.nextElementSibling
      if (!currentError?.classList.contains('ai-assistant-contract-error')) {
        return
      }

      if (textarea.value.trim() && textarea.value.length <= MAX_AI_MESSAGE_LENGTH) {
        clearValidationError(form)
      } else if (textarea.value.length > MAX_AI_MESSAGE_LENGTH) {
        showValidationError(form, LENGTH_ERROR)
      }
    })

    form.addEventListener(
      'submit',
      (event) => {
        if (!validate()) {
          event.preventDefault()
          event.stopPropagation()
        }
      },
      true,
    )
  }

  applyContract()

  const observer = new MutationObserver(applyContract)
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

function showValidationError(form: HTMLFormElement, message: string) {
  let error = form.nextElementSibling
  if (!error?.classList.contains('ai-assistant-contract-error')) {
    error = document.createElement('p')
    error.className = 'ai-assistant-contract-error'
    error.setAttribute('role', 'alert')
    form.insertAdjacentElement('afterend', error)
  }
  error.textContent = message
}

function clearValidationError(form: HTMLFormElement) {
  const error = form.nextElementSibling
  if (error?.classList.contains('ai-assistant-contract-error')) {
    error.remove()
  }
}
