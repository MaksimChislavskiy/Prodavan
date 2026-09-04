import { showCrmToast } from './crmToast'

const AI_SETTINGS_FEEDBACK_SELECTOR = [
  '.ai-settings-save-message',
  '.ai-settings-autopilot-message',
  '.ai-settings-upload-message',
].join(', ')
const AI_SETTINGS_INSTRUCTION_SELECTOR = '.ai-settings-instruction-input'
const AI_SETTINGS_INSTRUCTION_MAX_LENGTH = 5000

const lastMessages = new WeakMap<Element, string>()

export function installAiSettingsFeedbackController() {
  if (document.documentElement.dataset.aiSettingsFeedbackController === 'installed') {
    return
  }

  document.documentElement.dataset.aiSettingsFeedbackController = 'installed'

  const normalizeInstructionInput = (root: ParentNode = document) => {
    if (
      root instanceof HTMLTextAreaElement
      && root.matches(AI_SETTINGS_INSTRUCTION_SELECTOR)
    ) {
      root.maxLength = AI_SETTINGS_INSTRUCTION_MAX_LENGTH
    }

    root.querySelectorAll<HTMLTextAreaElement>(AI_SETTINGS_INSTRUCTION_SELECTOR).forEach((element) => {
      element.maxLength = AI_SETTINGS_INSTRUCTION_MAX_LENGTH
    })
  }

  const flushFeedback = (root: ParentNode = document) => {
    root.querySelectorAll(AI_SETTINGS_FEEDBACK_SELECTOR).forEach((element) => {
      const message = element.textContent?.trim() ?? ''
      if (!message || lastMessages.get(element) === message) {
        return
      }

      lastMessages.set(element, message)
      showCrmToast(message)
    })
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const parent = mutation.target.parentElement
        if (parent?.matches(AI_SETTINGS_FEEDBACK_SELECTOR)) {
          flushFeedback(parent.parentNode ?? document)
        }
        continue
      }

      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) {
          return
        }

        normalizeInstructionInput(node)

        if (node.matches(AI_SETTINGS_FEEDBACK_SELECTOR)) {
          const message = node.textContent?.trim() ?? ''
          if (message && lastMessages.get(node) !== message) {
            lastMessages.set(node, message)
            showCrmToast(message)
          }
        }

        flushFeedback(node)
      })
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  normalizeInstructionInput()
  flushFeedback()
}
