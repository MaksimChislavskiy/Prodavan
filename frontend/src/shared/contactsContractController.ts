import './contactsContractController.css'

const BULK_TOAST = /^Удалено (\d+) контактов\. Пропущено (\d+)\.$/
const BULK_SELECTED = /^Выбрано:\s*(\d+)$/
const BULK_CONFIRM = /^Удалить выбранные контакты \((\d+) шт\.\)\?$/

let installed = false
let observer: MutationObserver | null = null

export function installContactsContractController() {
  if (installed || typeof document === 'undefined') return
  installed = true

  const start = () => {
    normalizeContactsUi(document)
    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          const parent = record.target.parentElement
          if (parent) normalizeContactsUi(parent)
          continue
        }

        if (record.target instanceof Element) normalizeContactsUi(record.target)
        for (const node of record.addedNodes) {
          if (node instanceof Element) normalizeContactsUi(node)
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
}

function normalizeContactsUi(root: ParentNode) {
  if (window.location.pathname !== '/app/contacts') return

  const title = findOne(root, '#contacts-page-title')
  if (title?.textContent?.trim() === 'Все контакты') title.textContent = 'Контакты'

  normalizeSelectAll(root)
  normalizeRows(root)
  normalizeMenu(root)
  normalizeBulkPanel(root)
  normalizeEmptyState(root)
  normalizeErrorState(root)
  normalizePagination(root)
  normalizeConfirmation(root)
  normalizeToast(root)
  normalizeLoading(root)
}

function normalizeSelectAll(root: ParentNode) {
  findMany(root, 'th.contacts-table__select-cell').forEach((cell) => {
    if (cell.querySelector('.contacts-contract-select-all')) return
    const checkbox = cell.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!checkbox) return

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'contacts-contract-select-all'
    button.textContent = 'Выделить все'
    button.addEventListener('click', () => checkbox.click())
    cell.append(button)
  })
}

function normalizeRows(root: ParentNode) {
  findMany(root, '.contacts-table tbody tr').forEach((row) => {
    if (row.dataset.contactRowContract === '1') return
    row.dataset.contactRowContract = '1'
    row.classList.add('contacts-contract-row')
    row.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('button, input, a, [role="menu"]')) return
      row.querySelector<HTMLButtonElement>('.contacts-table__name-button')?.click()
    })
  })
}

function normalizeMenu(root: ParentNode) {
  findMany(root, '.contacts-row-menu__popup [role="menuitem"]').forEach((item) => {
    if (item.textContent?.trim() === 'Просмотреть') item.remove()
  })
}

function normalizeBulkPanel(root: ParentNode) {
  findMany(root, '.contacts-bulk-panel > span').forEach((label) => {
    const match = label.textContent?.trim().match(BULK_SELECTED)
    if (match) label.textContent = `Выбрано ${match[1]} контактов`
  })
}

function normalizeEmptyState(root: ParentNode) {
  findMany(root, '.contacts-empty').forEach((empty) => {
    const heading = empty.querySelector<HTMLElement>('h2')
    if (heading) heading.textContent = 'Контакты отсутствуют. Добавьте первый контакт'
    const paragraph = empty.querySelector<HTMLElement>('p')
    if (paragraph) paragraph.hidden = true
  })
}

function normalizeErrorState(root: ParentNode) {
  findMany(root, '.contacts-state').forEach((state) => {
    const heading = state.querySelector<HTMLElement>('h1')
    if (heading) {
      heading.textContent = 'Не удалось загрузить список контактов. Попробуйте обновить страницу'
    }
    const paragraph = state.querySelector<HTMLElement>('p')
    if (paragraph) paragraph.hidden = true
  })
}

function normalizePagination(root: ParentNode) {
  findMany(root, '.contacts-pagination').forEach((pagination) => {
    const buttons = pagination.querySelectorAll<HTMLButtonElement>('button')
    if (buttons[0]) buttons[0].textContent = 'Предыдущая страница'
    if (buttons[1]) buttons[1].textContent = 'Следующая страница'
  })
}

function normalizeConfirmation(root: ParentNode) {
  findMany(root, '.contact-confirm').forEach((dialog) => {
    const heading = dialog.querySelector<HTMLElement>('h2')
    const description = dialog.querySelector<HTMLElement>('#contact-delete-description')
    const error = dialog.querySelector<HTMLElement>('.contact-confirm__error')
    const text = heading?.textContent?.trim() ?? ''

    if (text === 'Удалить контакт?') {
      heading!.textContent =
        'Вы действительно хотите удалить контакт? Действие невозможно отменить. Все связанные сделки потеряют ссылку на контакт.'
      if (description) description.hidden = true
      return
    }

    const bulk = text.match(BULK_CONFIRM)
    if (bulk) {
      heading!.textContent =
        `Вы действительно хотите удалить выбранные контакты (${bulk[1]} шт.)? Действие невозможно отменить. Все связанные сделки потеряют ссылку на контакт.`
      if (description) description.hidden = true
      if (error) error.textContent = 'Не удалось удалить контакты. Попробуйте позже.'
      return
    }

    if (text.includes('удалить выбранные контакты') && error) {
      error.textContent = 'Не удалось удалить контакты. Попробуйте позже.'
    }
  })
}

function normalizeToast(root: ParentNode) {
  findMany(root, '.contacts-toast p').forEach((message) => {
    const text = message.textContent?.trim() ?? ''
    const bulk = text.match(BULK_TOAST)
    if (bulk) {
      message.textContent =
        `Удалено ${bulk[1]} контактов. Пропущено ${bulk[2]} (не найдены или уже удалены)`
      return
    }
    if (text === 'Контакт удалён.') message.textContent = 'Контакт удалён'
  })
}

function normalizeLoading(root: ParentNode) {
  findMany(root, '.contacts-page--loading').forEach((page) => {
    const header = page.querySelector<HTMLElement>('.contacts-page__header')
    const buttonSkeleton = page.querySelector<HTMLElement>('.contacts-skeleton--button')
    if (buttonSkeleton) buttonSkeleton.hidden = true

    if (header && !header.querySelector('.contacts-contract-loading-add')) {
      const addButton = document.createElement('button')
      addButton.type = 'button'
      addButton.disabled = true
      addButton.className = 'contacts-page__add-button contacts-contract-loading-add'
      addButton.textContent = 'Добавить контакт'
      header.append(addButton)
    }

    if (!page.querySelector('.contacts-contract-loading-pagination')) {
      const pagination = document.createElement('nav')
      pagination.className = 'contacts-pagination contacts-contract-loading-pagination'
      pagination.setAttribute('aria-label', 'Пагинация контактов')

      const previous = document.createElement('button')
      previous.type = 'button'
      previous.disabled = true
      previous.textContent = 'Предыдущая страница'

      const current = document.createElement('span')
      current.textContent = 'Страница 1'

      const next = document.createElement('button')
      next.type = 'button'
      next.disabled = true
      next.textContent = 'Следующая страница'

      pagination.append(previous, current, next)
      page.append(pagination)
    }
  })
}

function findOne(root: ParentNode, selector: string) {
  if (root instanceof Element && root.matches(selector)) return root as HTMLElement
  return root.querySelector<HTMLElement>(selector)
}

function findMany(root: ParentNode, selector: string) {
  const result: HTMLElement[] = []
  if (root instanceof Element && root.matches(selector)) result.push(root as HTMLElement)
  result.push(...Array.from(root.querySelectorAll<HTMLElement>(selector)))
  return result
}
