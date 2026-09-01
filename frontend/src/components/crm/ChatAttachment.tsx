import { useEffect, useState } from 'react'
import type { ApiChatAttachment } from '../../shared/api/chatApi'

export const MAX_CHAT_ATTACHMENT_SIZE = 20 * 1024 * 1024

export function PendingChatAttachment({
  file,
  disabled,
  onRemove,
}: {
  file: File
  disabled: boolean
  onRemove: () => void
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const isImage = file.type.startsWith('image/')

  useEffect(() => {
    if (!isImage) {
      setPreviewUrl(null)
      return
    }

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file, isImage])

  return (
    <div className="chat-pending-attachment">
      {previewUrl
        ? <img src={previewUrl} alt="Предпросмотр вложения" />
        : <span className="chat-file-icon" aria-hidden="true">▤</span>}
      <div>
        <strong>{file.name}</strong>
        <small>{formatFileSize(file.size)}</small>
      </div>
      <button
        type="button"
        aria-label="Удалить вложение"
        disabled={disabled}
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  )
}

export function ChatMessageAttachment({
  attachment,
}: {
  attachment: ApiChatAttachment
}) {
  const url = attachment.url
  const name = attachment.name || 'Вложение'

  if (attachment.type === 'image' && (attachment.preview_url || url)) {
    const previewUrl = attachment.preview_url || url
    return (
      <a
        className="chat-message-attachment chat-message-attachment--image"
        href={url || previewUrl || undefined}
        target="_blank"
        rel="noreferrer"
        download={url ? name : undefined}
      >
        <img src={previewUrl || undefined} alt={name} />
        <span>{name}</span>
      </a>
    )
  }

  const content = (
    <>
      <span className="chat-file-icon" aria-hidden="true">▤</span>
      <span>
        <strong>{name}</strong>
        <small>{formatFileSize(attachment.size)}</small>
      </span>
    </>
  )

  return url
    ? (
        <a
          className="chat-message-attachment chat-message-attachment--document"
          href={url}
          target="_blank"
          rel="noreferrer"
          download={name}
        >
          {content}
        </a>
      )
    : <div className="chat-message-attachment chat-message-attachment--document">{content}</div>
}

export function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 12.5 15 6a3 3 0 0 1 4.2 4.2l-8.4 8.4a5 5 0 0 1-7.1-7.1l8.2-8.2" />
    </svg>
  )
}

export function getMessagePreview(text: string, attachment: ApiChatAttachment | null) {
  if (text) {
    return text
  }
  if (!attachment) {
    return ''
  }
  const label = attachment.type === 'image' ? '[Фото]' : '[Документ]'
  return `${label} ${attachment.name || ''}`.trim()
}

export function formatFileSize(size: number | null) {
  if (size === null || size < 0 || !Number.isFinite(size)) {
    return ''
  }
  if (size < 1024) {
    return `${size} Б`
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} КБ`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}
