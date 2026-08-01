import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  createChatSocket,
  deleteChat,
  getChatMessages,
  getChats,
  markChatRead,
  sendChatMessage,
  type ApiChat,
  type ApiChatMessage,
  type ChatSocketEvent,
} from '../../shared/api/chatApi'
import {
  deleteContact,
  getContact,
  type ApiContact,
} from '../../shared/api/contactsApi'
import { ContactFormModal } from './ContactFormModal'
import './ChatPage.css'

type MessagesState = {
  items: ApiChatMessage[]
  cursor: string | null
  hasMore: boolean
  isLoading: boolean
  isLoadingOlder: boolean
  error: string
}

const emptyMessages: MessagesState = {
  items: [], cursor: null, hasMore: false, isLoading: false,
  isLoadingOlder: false, error: '',
}

const reconnectDelays = [1000, 2000, 5000, 10000, 30000]
const urlPattern = /(https?:\/\/[^\s]+)/g

export function ChatPage() {
  const [chats, setChats] = useState<ApiChat[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessagesState>(emptyMessages)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [isChatsLoading, setIsChatsLoading] = useState(true)
  const [chatsError, setChatsError] = useState('')
  const [sendError, setSendError] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [contactId, setContactId] = useState<string | null>(null)
  const [editingContact, setEditingContact] = useState<ApiContact | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const activeChatIdRef = useRef<string | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const seenMessageIdsRef = useRef(new Set<string>())
  const socketEventHandlerRef = useRef<(event: ChatSocketEvent) => void>(() => undefined)

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null

  const filteredChats = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU')
    if (!normalized) return chats
    return chats.filter((chat) =>
      `${chat.contact.name} ${chat.contact.company ?? ''}`
        .toLocaleLowerCase('ru-RU').includes(normalized),
    )
  }, [chats, query])

  const loadChats = useCallback(async (signal?: AbortSignal) => {
    setIsChatsLoading(true)
    setChatsError('')
    try {
      const response = await getChats(signal)
      setChats(sortChats(response.chats))
      setActiveChatId((current) =>
        current && response.chats.some((chat) => chat.id === current)
          ? current : response.chats[0]?.id ?? null,
      )
    } catch (error) {
      if (isAbortError(error)) return
      setChatsError(error instanceof Error ? error.message : 'Не удалось загрузить чаты.')
    } finally {
      if (!signal?.aborted) setIsChatsLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadChats(controller.signal)
    return () => controller.abort()
  }, [loadChats, reloadKey])

  useEffect(() => {
    activeChatIdRef.current = activeChatId
    setIsMenuOpen(false)
    setSendError('')
    if (!activeChatId) {
      setMessages(emptyMessages)
      return
    }

    const controller = new AbortController()
    setMessages({ ...emptyMessages, isLoading: true })
    void getChatMessages(activeChatId, null, controller.signal)
      .then((response) => {
        const items = sortMessages(uniqueMessages(response.messages))
        items.forEach((message) => seenMessageIdsRef.current.add(message.id))
        setMessages({
          items, cursor: response.next_cursor, hasMore: response.has_more,
          isLoading: false, isLoadingOlder: false, error: '',
        })
        window.setTimeout(() => scrollToBottom(), 0)
        if (document.visibilityState === 'visible') void readChat(activeChatId)
      })
      .catch((error) => {
        if (isAbortError(error)) return
        setMessages({
          ...emptyMessages,
          error: error instanceof Error ? error.message : 'Не удалось загрузить сообщения.',
        })
      })
    return () => controller.abort()
  }, [activeChatId])

  const readChat = async (chatId: string) => {
    try {
      await markChatRead(chatId)
      setChats((current) => current.map((chat) =>
        chat.id === chatId ? { ...chat, unread_count: 0 } : chat,
      ))
    } catch {
      // Read state is synchronized again after the next socket event/reload.
    }
  }

  useEffect(() => {
    const handleVisibility = () => {
      const chatId = activeChatIdRef.current
      if (document.visibilityState === 'visible' && chatId) void readChat(chatId)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => {
    let stopped = false
    const connect = () => {
      if (stopped) return
      const socket = createChatSocket()
      if (!socket) return
      socketRef.current = socket
      socket.onopen = () => {
        reconnectAttemptRef.current = 0
        void loadChats()
      }
      socket.onmessage = (event) => {
        try { socketEventHandlerRef.current(JSON.parse(event.data) as ChatSocketEvent) } catch { return }
      }
      socket.onclose = () => {
        if (stopped) return
        const attempt = reconnectAttemptRef.current
        const delay = reconnectDelays[Math.min(attempt, reconnectDelays.length - 1)]
        reconnectAttemptRef.current += 1
        reconnectTimerRef.current = window.setTimeout(connect, delay)
      }
    }
    connect()
    return () => {
      stopped = true
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current)
      socketRef.current?.close()
    }
  }, [loadChats])

  const handleSocketEvent = (event: ChatSocketEvent) => {
    if (event.event === 'chat_created') {
      setChats((current) => sortChats([event.chat, ...current.filter((c) => c.id !== event.chat.id)]))
      return
    }
    if (event.event === 'message_status_updated') {
      setMessages((current) => ({ ...current, items: current.items.map((message) =>
        message.id === event.message_id ? { ...message, status: event.status } : message,
      ) }))
      return
    }
    if (event.event === 'message_read') {
      setChats((current) => current.map((chat) =>
        chat.id === event.chat_id ? { ...chat, unread_count: 0 } : chat,
      ))
      return
    }
    if (event.event !== 'message_new') return
    const message = event.message
    const alreadySeen = seenMessageIdsRef.current.has(message.id)
    seenMessageIdsRef.current.add(message.id)
    setChats((current) => sortChats(current.map((chat) =>
      chat.id === event.chat_id ? {
        ...chat,
        last_message: message.text,
        last_message_at: message.created_at,
        unread_count: message.sender_type === 'contact' &&
          (activeChatIdRef.current !== chat.id || document.visibilityState !== 'visible')
          ? chat.unread_count + 1 : chat.unread_count,
      } : chat,
    )))
    if (!alreadySeen && activeChatIdRef.current === event.chat_id) {
      setMessages((current) => ({
        ...current, items: sortMessages(uniqueMessages([...current.items, message])),
      }))
      window.setTimeout(() => scrollToBottom(), 0)
      if (document.visibilityState === 'visible' && message.sender_type === 'contact') {
        void readChat(event.chat_id)
      }
    }
  }

  socketEventHandlerRef.current = handleSocketEvent

  const loadOlder = async () => {
    if (!activeChatId || !messages.cursor || messages.isLoadingOlder) return
    const container = messagesRef.current
    const previousHeight = container?.scrollHeight ?? 0
    setMessages((current) => ({ ...current, isLoadingOlder: true }))
    try {
      const response = await getChatMessages(activeChatId, messages.cursor)
      setMessages((current) => ({
        ...current,
        items: sortMessages(uniqueMessages([...response.messages, ...current.items])),
        cursor: response.next_cursor,
        hasMore: response.has_more,
        isLoadingOlder: false,
      }))
      window.setTimeout(() => {
        if (container) container.scrollTop += container.scrollHeight - previousHeight
      }, 0)
    } catch (error) {
      setMessages((current) => ({
        ...current, isLoadingOlder: false,
        error: error instanceof Error ? error.message : 'Не удалось загрузить историю.',
      }))
    }
  }

  const submitMessage = async () => {
    const text = draft.trim()
    if (!activeChatId || !text || text.length > 4096 || isSending) return
    setDraft('')
    setSendError('')
    setIsSending(true)
    const key = crypto.randomUUID()
    try {
      const message = await sendChatMessage(activeChatId, text, key)
      seenMessageIdsRef.current.add(message.id)
      setMessages((current) => ({
        ...current, items: sortMessages(uniqueMessages([...current.items, message])),
      }))
      window.setTimeout(() => scrollToBottom(), 0)
    } catch (error) {
      setDraft(text)
      setSendError(error instanceof Error ? error.message : 'Не удалось отправить сообщение.')
    } finally {
      setIsSending(false)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const removeActiveChat = async () => {
    if (!activeChatId) return
    const deletedId = activeChatId
    try {
      await deleteChat(deletedId)
      const remaining = chats.filter((chat) => chat.id !== deletedId)
      setChats(remaining)
      setActiveChatId(remaining[0]?.id ?? null)
      setIsDeleteOpen(false)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Не удалось удалить чат.')
      setIsDeleteOpen(false)
    }
  }

  const scrollToBottom = () => {
    const container = messagesRef.current
    if (container) container.scrollTop = container.scrollHeight
  }

  return (
    <section className="chat-page" aria-label="Чаты с клиентами">
      <aside className="chat-list-panel">
        <label className="chat-search">
          <SearchIcon />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" />
        </label>
        <div className="chat-list">
          {isChatsLoading && <ChatListSkeleton />}
          {chatsError && <div className="chat-panel-state"><p>{chatsError}</p><button onClick={() => setReloadKey((v) => v + 1)}>Повторить</button></div>}
          {!isChatsLoading && !chatsError && filteredChats.map((chat) => (
            <button
              type="button"
              className={`chat-list-item${chat.id === activeChatId ? ' chat-list-item--active' : ''}`}
              key={chat.id}
              onClick={() => setActiveChatId(chat.id)}
            >
              <span className="chat-list-item__main">
                <strong>{chat.contact.name || chat.contact.company || 'Без имени'}{chat.contact.is_deleted ? ' (Удалён)' : ''}</strong>
                <small>{chat.last_message || 'Нет сообщений'}</small>
              </span>
              <span className="chat-list-item__meta">
                <time>{formatChatDate(chat.last_message_at)}</time>
                {chat.unread_count > 0 && <b>{chat.unread_count > 99 ? '99+' : chat.unread_count}</b>}
              </span>
            </button>
          ))}
          {!isChatsLoading && !chatsError && query && filteredChats.length === 0 && <p className="chat-list-empty">Чаты не найдены</p>}
        </div>
      </aside>

      <article className="chat-dialog">
        {!isChatsLoading && chats.length === 0 && !chatsError && <EmptyDialog text="Сообщений пока нет" />}
        {!activeChat && chats.length > 0 && <EmptyDialog text="Выберите чат из списка" />}
        {activeChat && <>
          <header className="chat-dialog__header">
            <h1>{activeChat.contact.name || activeChat.contact.company || 'Без имени'}</h1>
            <div className="chat-menu-wrap">
              <button className="chat-kebab" type="button" aria-label="Меню чата" aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen((value) => !value)}>•••</button>
              {isMenuOpen && <div className="chat-kebab-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setContactId(activeChat.contact.id); setIsMenuOpen(false) }}>Показать контакт</button>
                <button type="button" role="menuitem" onClick={() => { setIsDeleteOpen(true); setIsMenuOpen(false) }}>Удалить чат</button>
              </div>}
            </div>
          </header>
          <div className="chat-messages" ref={messagesRef} onScroll={(event) => {
            if (event.currentTarget.scrollTop < 80 && messages.hasMore) void loadOlder()
          }}>
            {messages.hasMore && <button className="chat-load-older" type="button" onClick={() => void loadOlder()} disabled={messages.isLoadingOlder}>{messages.isLoadingOlder ? 'Загрузка…' : 'Показать более ранние сообщения'}</button>}
            {messages.isLoading && <div className="chat-messages-loading"><span /><span /><span /></div>}
            {messages.error && <div className="chat-panel-state"><p>{messages.error}</p><button onClick={() => setActiveChatId((id) => { window.setTimeout(() => setActiveChatId(id), 0); return null })}>Повторить</button></div>}
            {!messages.isLoading && messages.items.map((message) => <MessageBubble message={message} key={message.id} />)}
            {!messages.isLoading && !messages.error && messages.items.length === 0 && <p className="chat-dialog-empty">В этом чате пока нет сообщений</p>}
          </div>
          <footer className="chat-composer">
            <textarea
              ref={inputRef}
              value={draft}
              placeholder="Сообщение"
              maxLength={4096}
              disabled={isSending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitMessage() }
              }}
            />
            <button type="button" aria-label="Отправить сообщение" disabled={!draft.trim() || isSending} onClick={() => void submitMessage()}><SendIcon /></button>
            {sendError && <p role="alert">{sendError}</p>}
          </footer>
        </>}
      </article>

      {isDeleteOpen && <ConfirmModal title="Удалить чат?" text="Переписка исчезнет из списка. Это действие нельзя отменить." onCancel={() => setIsDeleteOpen(false)} onConfirm={() => void removeActiveChat()} />}
      {contactId && <ContactCard contactId={contactId} onClose={() => setContactId(null)} onEdit={(contact) => { setContactId(null); setEditingContact(contact) }} onDeleted={() => { setContactId(null); void loadChats() }} />}
      {editingContact && <ContactFormModal mode="edit" contactId={editingContact.id} contactName={editingContact.name} onClose={() => setEditingContact(null)} onCreated={() => undefined} onUpdated={() => { setEditingContact(null); void loadChats() }} onNotFound={() => { setEditingContact(null); void loadChats() }} />}
    </section>
  )
}

function MessageBubble({ message }: { message: ApiChatMessage }) {
  const parts = message.text.split(urlPattern)
  return <div className={`chat-message-row chat-message-row--${message.sender_type}`}>
    <div className="chat-message">
      <p>{parts.map((part, index) => part.match(/^https?:\/\//) ? <a href={part} target="_blank" rel="noreferrer" key={`${part}-${index}`}>{part}</a> : part)}</p>
      <span><time>{formatTime(message.created_at)}</time>{message.sender_type === 'user' && <MessageStatus status={message.status} sentByAi={message.sent_by_ai} />}</span>
    </div>
  </div>
}

function MessageStatus({ status, sentByAi }: { status: ApiChatMessage['status']; sentByAi: boolean }) {
  return <small className={status === 'failed' ? 'chat-message-status--failed' : ''} title={sentByAi ? 'Отправлено AI' : undefined}>
    {sentByAi ? 'AI · ' : ''}{status === 'delivered' ? '✓✓' : status === 'failed' ? 'Ошибка' : '✓'}
  </small>
}

function ContactCard({ contactId, onClose, onEdit, onDeleted }: { contactId: string; onClose: () => void; onEdit: (contact: ApiContact) => void; onDeleted: () => void }) {
  const [contact, setContact] = useState<ApiContact | null>(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void getContact(contactId, controller.signal).then(setContact).catch((e) => {
      if (!isAbortError(e)) setError(e instanceof Error ? e.message : 'Не удалось загрузить контакт.')
    })
    return () => controller.abort()
  }, [contactId])
  const share = async () => {
    if (!contact) return
    const text = [contact.name, contact.phone, contact.email, contact.company].filter(Boolean).join('\n')
    if (navigator.share) await navigator.share({ title: contact.name, text }).catch(() => undefined)
    else await navigator.clipboard.writeText(text).catch(() => undefined)
  }
  const remove = async () => {
    try { await deleteContact(contactId); onDeleted() } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось удалить контакт.'); setConfirmDelete(false) }
  }
  return <div className="chat-modal-backdrop" role="presentation" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose() }}>
    <article className="chat-contact-card" role="dialog" aria-modal="true" aria-label="Карточка контакта">
      <button className="chat-contact-card__close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
      {!contact && !error && <p className="chat-contact-card__state">Загружаем контакт…</p>}
      {error && <p className="chat-contact-card__state" role="alert">{error}</p>}
      {contact && <>
        <h2>{contact.name}</h2>
        <div className="chat-contact-card__details">
          <p>{contact.phone || 'Телефон не указан'} <small>телефон</small></p>
          <p>{contact.email || 'E-mail не указан'} <small>e-mail</small></p>
          <p>{contact.company || 'Компания не указана'} <small>компания</small></p>
        </div>
        <div className="chat-contact-card__actions">
          <button type="button" onClick={() => void share()}><span>↗</span>Поделиться</button>
          <button type="button" onClick={() => onEdit(contact)}><span>✎</span>Изменить</button>
          <button type="button" onClick={() => setConfirmDelete(true)}><span>⌫</span>Удалить</button>
        </div>
      </>}
      {confirmDelete && <ConfirmModal title="Удалить контакт?" text="Контакт будет удалён, но история чата сохранится." onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()} />}
    </article>
  </div>
}

function ConfirmModal({ title, text, onCancel, onConfirm }: { title: string; text: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="chat-confirm-backdrop" role="presentation"><div className="chat-confirm" role="alertdialog" aria-modal="true"><h2>{title}</h2><p>{text}</p><div><button type="button" onClick={onCancel}>Отмена</button><button type="button" onClick={onConfirm}>Удалить</button></div></div></div>
}

function EmptyDialog({ text }: { text: string }) { return <div className="chat-empty"><span><ChatIcon /></span><h2>{text}</h2></div> }
function ChatListSkeleton() { return <>{[1, 2, 3, 4].map((item) => <div className="chat-list-skeleton" key={item}><span /><i /></div>)}</> }
function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg> }
function SendIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 17-8-8 17-2-7-7-2Z" /><path d="m10 13 10-10" /></svg> }
function ChatIcon() { return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 5h20a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H15l-7 5v-5H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" /></svg> }

function sortChats(chats: ApiChat[]) { return [...chats].sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '') || b.id.localeCompare(a.id)) }
function sortMessages(items: ApiChatMessage[]) { return [...items].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) }
function uniqueMessages(items: ApiChatMessage[]) { return [...new Map(items.map((item) => [item.id, item])).values()] }
function formatTime(value: string) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function formatChatDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value); const now = new Date()
  if (date.toDateString() === now.toDateString()) return formatTime(value)
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date)
}
function isAbortError(error: unknown) { return error instanceof DOMException && error.name === 'AbortError' }
