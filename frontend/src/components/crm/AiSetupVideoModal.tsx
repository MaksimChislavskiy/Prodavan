import { useEffect, useMemo, useRef } from 'react'
import './AiSetupVideoModal.css'

type AiSetupVideoModalProps = {
  isOpen: boolean
  videoUrl: string
  onClose: () => void
}

function youtubeEmbedUrl(value: string) {
  if (!value) return ''

  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    let videoId = ''

    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] ?? ''
    } else if (
      host === 'youtube.com'
      || host === 'www.youtube.com'
      || host === 'm.youtube.com'
      || host === 'www.youtube-nocookie.com'
    ) {
      if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v') ?? ''
      } else {
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') {
          videoId = parts[1] ?? ''
        }
      }
    }

    if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return ''

    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=0&rel=0`
  } catch {
    return ''
  }
}

export function AiSetupVideoModal({ isOpen, videoUrl, onClose }: AiSetupVideoModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const embedUrl = useMemo(() => youtubeEmbedUrl(videoUrl), [videoUrl])

  useEffect(() => {
    if (!isOpen) return

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="ai-setup-video-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="ai-setup-video-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-setup-video-title"
      >
        <div className="ai-setup-video-modal__header">
          <h2 id="ai-setup-video-title">Обучающее видео</h2>
          <button
            ref={closeButtonRef}
            className="ai-setup-video-modal__close"
            type="button"
            aria-label="Закрыть обучающее видео"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {embedUrl ? (
          <div className="ai-setup-video-modal__frame-wrap">
            <iframe
              key={embedUrl}
              className="ai-setup-video-modal__frame"
              src={embedUrl}
              title="Обучающее видео по настройке AI"
              loading="eager"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        ) : (
          <p className="ai-setup-video-modal__unavailable" role="alert">
            Обучающее видео временно недоступно.
          </p>
        )}
      </div>
    </div>
  )
}
