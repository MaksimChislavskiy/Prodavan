import './aiMaterialsController.css'

const AI_SETUP_VIDEO_URL = (import.meta.env.VITE_AI_SETUP_VIDEO_URL ?? '').trim()
const MODAL_ID = 'prodavan-ai-setup-video-modal'

export function installAiMaterialsController() {
  if (document.documentElement.dataset.aiMaterialsController === 'installed') {
    return
  }

  document.documentElement.dataset.aiMaterialsController = 'installed'
  document.addEventListener('click', handleDocumentClick)
}

function handleDocumentClick(event: MouseEvent) {
  if (!(event.target instanceof Element)) {
    return
  }

  const button = event.target.closest('.ai-settings-video-button')

  if (!(button instanceof HTMLButtonElement)) {
    return
  }

  event.preventDefault()
  openVideoModal()
}

function openVideoModal() {
  document.getElementById(MODAL_ID)?.remove()

  const overlay = document.createElement('div')
  overlay.id = MODAL_ID
  overlay.className = 'ai-materials-video-overlay'
  overlay.setAttribute('role', 'presentation')

  const dialog = document.createElement('div')
  dialog.className = 'ai-materials-video-modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', `${MODAL_ID}-title`)

  const header = document.createElement('div')
  header.className = 'ai-materials-video-modal__header'

  const title = document.createElement('h2')
  title.id = `${MODAL_ID}-title`
  title.textContent = 'Обучающее видео'

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'ai-materials-video-modal__close'
  closeButton.setAttribute('aria-label', 'Закрыть обучающее видео')
  closeButton.textContent = '×'

  header.append(title, closeButton)
  dialog.append(header)

  const embedUrl = getYouTubeEmbedUrl(AI_SETUP_VIDEO_URL)

  if (embedUrl) {
    const frame = document.createElement('iframe')
    frame.className = 'ai-materials-video-modal__frame'
    frame.src = embedUrl
    frame.title = 'Обучающее видео Продаван'
    frame.allow = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
    frame.allowFullscreen = true
    frame.referrerPolicy = 'strict-origin-when-cross-origin'
    dialog.append(frame)
  } else {
    const notice = document.createElement('p')
    notice.className = 'ai-materials-video-modal__notice'
    notice.textContent = 'Ссылка на обучающее YouTube-видео не настроена.'
    dialog.append(notice)
  }

  overlay.append(dialog)
  document.body.append(overlay)

  const close = () => {
    document.removeEventListener('keydown', handleKeyDown)
    overlay.remove()
  }

  const handleKeyDown = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key === 'Escape') {
      close()
    }
  }

  closeButton.addEventListener('click', close)
  overlay.addEventListener('click', (clickEvent) => {
    if (clickEvent.target === overlay) {
      close()
    }
  })
  document.addEventListener('keydown', handleKeyDown)
  closeButton.focus()
}

function getYouTubeEmbedUrl(value: string) {
  if (!value) {
    return ''
  }

  try {
    const url = new URL(value)
    let videoId = ''

    if (url.hostname === 'youtu.be') {
      videoId = url.pathname.slice(1).split('/')[0] ?? ''
    } else if (url.hostname.endsWith('youtube.com') || url.hostname.endsWith('youtube-nocookie.com')) {
      if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v') ?? ''
      } else if (url.pathname.startsWith('/embed/')) {
        videoId = url.pathname.split('/')[2] ?? ''
      } else if (url.pathname.startsWith('/shorts/')) {
        videoId = url.pathname.split('/')[2] ?? ''
      }
    }

    if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
      return ''
    }

    const embed = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`)
    embed.searchParams.set('rel', '0')
    return embed.toString()
  } catch {
    return ''
  }
}
