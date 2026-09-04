import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { ApiError } from '../../shared/api/apiClient'
import {
  createChatMessageIdempotencyKey,
  createChatSocket,
  deleteChat,
  getChatMessages,
  getChatsPage,
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
import { showCrmToast } from '../../shared/crmToast'
import {
  ChatMessageAttachment,
  getMessagePreview,
  MAX_CHAT_ATTACHMENT_SIZE,
  PaperclipIcon,
  PendingChatAttachment,
} from './ChatAttachment'
import { ContactFormModal } from './ContactFormModal'
import './ChatPage.css'
import './ChatPageContract.css'

type MessagesState = {
  items: ApiChatMessage[]
  cursor: string | null
  hasMore: boolean
  isLoading: boolean
  isLoadingOlder: boolean
  error: string
}

type PendingSend = {
  chatId: string
  text: string
  attachment: File | null
  key: string
}

const CHAT_PAGE_SIZE = 20
const MESSAGE_ID_CACHE_SIZE = 1000
const reconnectDelays = [1000, 2000, 5000, 10000, 30000]
const urlPattern = /(https?:\/\/[^\s]+)/g

const emptyMessages: MessagesState = {
  items: [],
  cursor: null,
  hasMore: false,
  isLoading: false,
  isLoadingOlder: false,
  error: '',
}

export function ChatPage() {
  const [chats, setChats] = useState<ApiChat[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessagesState>(emptyMessages)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [isChatsLoading, setIsChatsLoading] = useState(true)
  const [isChatsLoadingMore, setIsChatsLoadingMore] = useState(false)
  const [hasMoreChats, setHasMoreChats] = useState(false)
  const [chatsError, setChatsError] = useState('')
  const [sendError, setSendError] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [contactId, setContactId] = useState<string | null>(null)
  const [editingContact, setEditingContact] = useState<ApiContact | null>(null)
  const [messagesReloadKey, setMessagesReloadKey] = useState(0)
  const [isMobileListOpen, setIsMobileListOpen] = useState(false)

  const activeChatIdRef = useRef<string | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const chatListEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const socketEventHandlerRef = useRef<(event: ChatSocketEvent) => void>(() => undefined)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const hasSocketOpenedRef = useRef(false)
  const loadedChatPagesRef = useRef(1)
  const seenMessageIdsRef = useRef(new Set<string>())
  const seenMessageOrderRef = useRef<string[]>([])
  const pendingSendRef = useRef<PendingSend | null>(null)

  const chatsControllerRef = useRef<AbortController | null>(null)
  const messagesControllerRef = useRef<AbortController | null>(null)
  const olderControllerRef = useRef<AbortController | null>(null)
  const readControllerRef = useRef<AbortController | null>(null)
  const sendControllerRef = useRef<AbortController | null>(null)
  const deleteControllerRef = useRef<AbortController | null>(null)

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null

  const filteredChats = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU')
    if (!normalized) {
      return chats
    }

    return chats.filter((chat) =>
      `${chat.contact.name} ${chat.contact.company ?? ''}`
        .toLocaleLowerCase('ru-RU')
        .includes(normalized),
    )
  }, [chats, query])

  const abortActiveChatRequests = useCallback(() => {
    messagesControllerRef.current?.abort()
    olderControllerRef.current?.abort()
    readControllerRef.current?.abort()
    sendControllerRef.current?.abort()
    messagesControllerRef.current = null
    olderControllerRef.current = null
    readControllerRef.current = null
    sendControllerRef.current = null
  }, [])

  const loadInitialChats = useCallback(async () => {
    chatsControllerRef.current?.abort()
    const controller = new AbortController()
    chatsControllerRef.current = controller
    setIsChatsLoading(true)
    setChatsError('')

    try {
      const response = await getChatsPage(1, CHAT_PAGE_SIZE, controller.signal)
      if (controller.signal.aborted) {
        return
      }

      const nextChats = sortChats(uniqueChats(response.chats))
      loadedChatPagesRef.current = 1
      setChats(nextChats)
      setHasMoreChats(response.page * response.limit < response.total)
      setActiveChatId((current) =>
        current && nextChats.some((chat) => chat.id === current)
          ? current
          : nextChats[0]?.id ?? null,
      )
    } catch (error) {
      if (isAbortError(error)) {
        return
      }
      setChatsError(
        error instanceof Error ? error.message : 'Не удалось загрузить чаты.',
      )
    } finally {
      if (chatsControllerRef.current === controller) {
        chatsControllerRef.current = null
      }
      if (!controller.signal.aborted) {
        setIsChatsLoading(false)
      }
    }
  }, [])

  const reloadLoadedChats = useCallback(async () => {
    chatsControllerRef.current?.abort()
    const controller = new AbortController()
    chatsControllerRef.current = controller
    const pageCount = Math.max(1, loadedChatPagesRef.current)

    try {
      const collected: ApiChat[] = []
      let lastTotal = 0
      let lastLimit = CHAT_PAGE_SIZE

      for (let page = 1; page <= pageCount; page += 1) {
        const response = await getChatsPage(
          page,
          CHAT_PAGE_SIZE,
          controller.signal,
        )
        collected.push(...response.chats)
        lastTotal = response.total
        lastLimit = response.limit
      }

      if (controller.signal.aborted) {
        return
      }

      const nextChats = sortChats(uniqueChats(collected))
      setChats(nextChats)
      setHasMoreChats(pageCount * lastLimit < lastTotal)
      setActiveChatId((current) =>
        current && nextChats.some((chat) => chat.id === current)
          ? current
          : nextChats[0]?.id ?? null,
      )
    } catch (error) {
      if (!isAbortError(error)) {
        setChatsError(
          error instanceof Error ? error.message : 'Не удалось синхронизировать чаты.',
        )
      }
    } finally {
      if (chatsControllerRef.current === controller) {
        chatsControllerRef.current = null
      }
    }
  }, [])

  const loadMoreChats = useCallback(async () => {
    if (
      isChatsLoading
      || isChatsLoadingMore
      || !hasMoreChats
      || query.trim()
    ) {
      return
    }

    setIsChatsLoadingMore(true)
    const controller = new AbortController()
    chatsControllerRef.current?.abort()
    chatsControllerRef.current = controller
    const page = loadedChatPagesRef.current + 1

    try {
      const response = await getChatsPage(
        page,
        CHAT_PAGE_SIZE,
        controller.signal,
      )
      if (controller.signal.aborted) {
        return
      }

      loadedChatPagesRef.current = page
      setChats((current) => sortChats(uniqueChats([...current, ...response.chats])))
      setHasMoreChats(page * response.limit < response.total)
    } catch (error) {
      if (!isAbortError(error)) {
        showCrmToast(
          error instanceof Error ? error.message : 'Не удалось загрузить ещё чаты.',
        )
      }
    } finally {
      if (chatsControllerRef.current === controller) {
        chatsControllerRef.current = null
      }
      setIsChatsLoadingMore(false)
    }
  }, [hasMoreChats, isChatsLoading, isChatsLoadingMore, query])

  const readChat = useCallback(async (chatId: string) => {
    readControllerRef.current?.abort()
    const controller = new AbortController()
    readControllerRef.current = controller

    try {
      await markChatRead(chatId, controller.signal)
      if (controller.signal.aborted) {
        return
      }
      setChats((current) => current.map((chat) =>
        chat.id === chatId ? { ...chat, unread_count: 0 } : chat,
      ))
      setMessages((current) => ({
        ...current,
        items: current.items.map((message) =>
          message.sender_type === 'contact' && message.read_at === null
            ? { ...message, read_at: new Date().toISOString() }
            : message,
        ),
      }))
    } catch (error) {
      if (!isAbortError(error)) {
        // read state will be reconciled on the next socket event/reconnect
      }
    } finally {
      if (readControllerRef.current === controller) {
        readControllerRef.current = null
      }
    }
  }, [])

  const loadActiveMessages = useCallback(async (chatId: string) => {
    messagesControllerRef.current?.abort()
    const controller = new AbortController()
    messagesControllerRef.current = controller
    setMessages({ ...emptyMessages, isLoading: true })

    try {
      const response = await getChatMessages(chatId, null, controller.signal)
      if (controller.signal.aborted || activeChatIdRef.current !== chatId) {
        return
      }

      const items = sortMessages(uniqueMessages(response.messages))
      rememberMessageIds(items, seenMessageIdsRef.current, seenMessageOrderRef.current)
      setMessages({
        items,
        cursor: response.next_cursor,
        hasMore: response.has_more,
        isLoading: false,
        isLoadingOlder: false,
        error: '',
      })
      window.setTimeout(scrollToBottom, 0)

      if (document.visibilityState === 'visible') {
        void readChat(chatId)
      }
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      if (error instanceof ApiError && error.status === 404) {
        setChats((current) => current.filter((chat) => chat.id !== chatId))
        setActiveChatId((current) => current === chatId ? null : current)
        void reloadLoadedChats()
        return
      }

      setMessages({
        ...emptyMessages,
        error: error instanceof Error
          ? error.message
          : 'Не удалось загрузить сообщения.',
      })
    } finally {
      if (messagesControllerRef.current === controller) {
        messagesControllerRef.current = null
      }
    }
  }, [readChat, reloadLoadedChats])

  useEffect(() => {
    void loadInitialChats()
    return () => {
      chatsControllerRef.current?.abort()
      abortActiveChatRequests()
      deleteControllerRef.current?.abort()
    }
  }, [abortActiveChatRequests, loadInitialChats])

  useEffect(() => {
    if (query.trim() || !hasMoreChats || !chatListEndRef.current) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreChats()
        }
      },
      { rootMargin: '160px' },
    )

    observer.observe(chatListEndRef.current)
    return () => observer.disconnect()
  }, [hasMoreChats, loadMoreChats, query])

  useEffect(() => {
    abortActiveChatRequests()
    activeChatIdRef.current = activeChatId
    setIsMenuOpen(false)
    setSendError('')
    setIsMobileListOpen(false)
    setAttachment(null)
    pendingSendRef.current = null
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }

    if (!activeChatId) {
      setMessages(emptyMessages)
      return
    }

    void loadActiveMessages(activeChatId)
    return () => abortActiveChatRequests()
  }, [
    abortActiveChatRequests,
    activeChatId,
    loadActiveMessages,
    messagesReloadKey,
  ])

  useEffect(() => {
    const handleVisibility = () => {
      const chatId = activeChatIdRef.current
      if (document.visibilityState === 'visible' && chatId) {
        void readChat(chatId)
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [readChat])

  useEffect(() => {
    let stopped = false

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = (connect: () => void) => {
      if (stopped) {
        return
      }
      clearReconnectTimer()
      const attempt = reconnectAttemptRef.current
      const delay = reconnectDelays[Math.min(attempt, reconnectDelays.length - 1)]
      reconnectAttemptRef.current += 1
      reconnectTimerRef.current = window.setTimeout(connect, delay)
    }

    const connect = () => {
      if (stopped) {
        return
      }

      const socket = createChatSocket()
      if (!socket) {
        void reloadLoadedChats()
        return
      }

      socketRef.current = socket
      socket.onopen = () => {
        const isReconnect = hasSocketOpenedRef.current
        hasSocketOpenedRef.current = true
        reconnectAttemptRef.current = 0
        clearReconnectTimer()

        if (isReconnect) {
          void reloadLoadedChats()
          const chatId = activeChatIdRef.current
          if (chatId) {
            void loadActiveMessages(chatId)
          }
        }
      }
      socket.onmessage = (rawEvent) => {
        try {
          socketEventHandlerRef.current(
            JSON.parse(rawEvent.data) as ChatSocketEvent,
          )
        } catch {
          return
        }
      }
      socket.onclose = (closeEvent) => {
        if (stopped) {
          return
        }

        if (closeEvent.code === 1008) {
          void reloadLoadedChats().finally(() => scheduleReconnect(connect))
          return
        }

        scheduleReconnect(connect)
      }
    }

    connect()
    return () => {
      stopped = true
      clearReconnectTimer()
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [loadActiveMessages, reloadLoadedChats])

  const handleSocketEvent = (event: ChatSocketEvent) => {
    if (event.event === 'error') {
      showCrmToast(event.message || 'Ошибка WebSocket-соединения.')
      return
    }

    if (event.event === 'chat_created') {
      setChats((current) => sortChats(uniqueChats([
        event.chat,
        ...current.filter((chat) => chat.id !== event.chat.id),
      ])))
      return
    }

    if (event.event === 'message_status_updated') {
      if (activeChatIdRef.current === event.chat_id) {
        setMessages((current) => ({
          ...current,
          items: current.items.map((message) =>
            message.id === event.message_id
              ? { ...message, status: event.status }
              : message,
          ),
        }))
      }
      return
    }

    if (event.event === 'message_read') {
      setChats((current) => current.map((chat) =>
        chat.id === event.chat_id ? { ...chat, unread_count: 0 } : chat,
      ))
      if (activeChatIdRef.current === event.chat_id) {
        setMessages((current) => ({
          ...current,
          items: current.items.map((message) =>
            message.sender_type === 'contact' && message.read_at === null
              ? { ...message, read_at: event.read_at }
              : message,
          ),
        }))
      }
      return
    }

    if (event.event !== 'message_new') {
      return
    }

    const message = event.message
    const alreadySeen = seenMessageIdsRef.current.has(message.id)
    const shouldAutoScroll = (
      activeChatIdRef.current === event.chat_id
      && isChatAtBottom(messagesRef.current)
    )
    rememberMessageIds(
      [message],
      seenMessageIdsRef.current,
      seenMessageOrderRef.current,
    )

    let matchedChat = false
    setChats((current) => sortChats(current.map((chat) => {
      if (chat.id !== event.chat_id) {
        return chat
      }

      matchedChat = true
      const shouldIncrement = (
        message.sender_type === 'contact'
        && (
          activeChatIdRef.current !== chat.id
          || document.visibilityState !== 'visible'
        )
      )

      return {
        ...chat,
        last_message: getMessagePreview(message.text, message.attachment),
        last_message_at: message.created_at,
        unread_count: shouldIncrement
          ? chat.unread_count + 1
          : chat.unread_count,
      }
    })))

    if (!matchedChat) {
      void reloadLoadedChats()
    }

    if (!alreadySeen && activeChatIdRef.current === event.chat_id) {
      setMessages((current) => ({
        ...current,
        items: sortMessages(uniqueMessages([...current.items, message])),
      }))
      if (shouldAutoScroll) {
        window.setTimeout(scrollToBottom, 0)
      }
    }

    if (
      message.sender_type === 'contact'
      && activeChatIdRef.current === event.chat_id
      && document.visibilityState === 'visible'
    ) {
      void readChat(event.chat_id)
    }
  }

  socketEventHandlerRef.current = handleSocketEvent

  const loadOlder = async () => {
    const chatId = activeChatIdRef.current
    if (!chatId || !messages.cursor || messages.isLoadingOlder) {
      return
    }

    olderControllerRef.current?.abort()
    const controller = new AbortController()
    olderControllerRef.current = controller
    const container = messagesRef.current
    const previousHeight = container?.scrollHeight ?? 0
    const cursor = messages.cursor
    setMessages((current) => ({ ...current, isLoadingOlder: true }))

    try {
      const response = await getChatMessages(chatId, cursor, controller.signal)
      if (controller.signal.aborted || activeChatIdRef.current !== chatId) {
        return
      }

      rememberMessageIds(
        response.messages,
        seenMessageIdsRef.current,
        seenMessageOrderRef.current,
      )
      setMessages((current) => ({
        ...current,
        items: sortMessages(uniqueMessages([
          ...response.messages,
          ...current.items,
        ])),
        cursor: response.next_cursor,
        hasMore: response.has_more,
        isLoadingOlder: false,
        error: '',
      }))
      window.setTimeout(() => {
        if (container) {
          container.scrollTop += container.scrollHeight - previousHeight
        }
      }, 0)
    } catch (error) {
      if (isAbortError(error)) {
        return
      }
      setMessages((current) => ({
        ...current,
        isLoadingOlder: false,
        error: error instanceof Error
          ? error.message
          : 'Не удалось загрузить историю.',
      }))
    } finally {
      if (olderControllerRef.current === controller) {
        olderControllerRef.current = null
      }
    }
  }

  const handleDraftChange = (value: string) => {
    setDraft(value)
    setSendError('')
    const pending = pendingSendRef.current
    if (
      pending
      && (
        pending.chatId !== activeChatIdRef.current
        || pending.text !== value.trim()
        || pending.attachment !== attachment
      )
    ) {
      pendingSendRef.current = null
    }
  }

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    if (!file) {
      return
    }
    if (file.size > MAX_CHAT_ATTACHMENT_SIZE) {
      setSendError('Размер вложения не должен превышать 20 МБ.')
      event.target.value = ''
      return
    }

    setAttachment(file)
    setSendError('')
    pendingSendRef.current = null
  }

  const removeAttachment = () => {
    if (isSending) {
      return
    }
    setAttachment(null)
    pendingSendRef.current = null
    setSendError('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const submitMessage = async () => {
    const chatId = activeChatIdRef.current
    const text = draft.trim()
    if (
      !chatId
      || (!text && !attachment)
      || text.length > 4096
      || isSending
    ) {
      return
    }

    const previousPending = pendingSendRef.current
    const pending = (
      previousPending
      && previousPending.chatId === chatId
      && previousPending.text === text
      && previousPending.attachment === attachment
    )
      ? previousPending
      : {
          chatId,
          text,
          attachment,
          key: createChatMessageIdempotencyKey(),
        }

    pendingSendRef.current = pending
    sendControllerRef.current?.abort()
    const controller = new AbortController()
    sendControllerRef.current = controller
    setDraft('')
    setSendError('')
    setIsSending(true)

    try {
      const message = await sendChatMessage(
        chatId,
        text,
        pending.key,
        controller.signal,
        pending.attachment,
      )
      if (controller.signal.aborted) {
        return
      }

      if (pendingSendRef.current?.key === pending.key) {
        pendingSendRef.current = null
      }
      setAttachment(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      rememberMessageIds(
        [message],
        seenMessageIdsRef.current,
        seenMessageOrderRef.current,
      )

      if (activeChatIdRef.current === chatId) {
        setMessages((current) => ({
          ...current,
          items: sortMessages(uniqueMessages([...current.items, message])),
        }))
        window.setTimeout(scrollToBottom, 0)
      }
      setChats((current) => sortChats(current.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              last_message: getMessagePreview(message.text, message.attachment),
              last_message_at: message.created_at,
            }
          : chat,
      )))
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      if (activeChatIdRef.current === chatId) {
        setDraft(text)
        setSendError(
          error instanceof Error
            ? error.message
            : 'Не удалось отправить сообщение.',
        )
      }
    } finally {
      if (sendControllerRef.current === controller) {
        sendControllerRef.current = null
      }
      setIsSending(false)
      if (activeChatIdRef.current === chatId) {
        window.setTimeout(() => inputRef.current?.focus(), 0)
      }
    }
  }

  const selectChat = (chatId: string) => {
    if (chatId === activeChatIdRef.current) {
      setIsMobileListOpen(false)
      return
    }

    abortActiveChatRequests()
    setActiveChatId(chatId)
    setIsMobileListOpen(false)
  }

  const removeActiveChat = async () => {
    const deletedId = activeChatIdRef.current
    if (!deletedId) {
      return
    }

    const deletedIndex = chats.findIndex((chat) => chat.id === deletedId)
    abortActiveChatRequests()
    deleteControllerRef.current?.abort()
    const controller = new AbortController()
    deleteControllerRef.current = controller

    try {
      await deleteChat(deletedId, controller.signal)
      if (controller.signal.aborted) {
        return
      }

      const remaining = chats.filter((chat) => chat.id !== deletedId)
      const nextChat = remaining[deletedIndex] ?? remaining[0] ?? null
      setChats(remaining)
      setActiveChatId(nextChat?.id ?? null)
      setMessages(emptyMessages)
      setIsDeleteOpen(false)
      setIsMenuOpen(false)
    } catch (error) {
      if (!isAbortError(error)) {
        setSendError(
          error instanceof Error ? error.message : 'Не удалось удалить чат.',
        )
      }
      setIsDeleteOpen(false)
    } finally {
      if (deleteControllerRef.current === controller) {
        deleteControllerRef.current = null
      }
    }
  }

  const showContact = () => {
    if (!activeChat) {
      return
    }

    setIsMenuOpen(false)
    if (activeChat.contact.is_deleted) {
      showCrmToast('Контакт удалён')
      return
    }
    setContactId(activeChat.contact.id)
  }

  return (
    <section
      className={`chat-page${isMobileListOpen ? ' chat-page--list-open' : ''}`}
      aria-label="Чаты с клиентами"
    >
      <aside className="chat-list-panel" aria-label="Список чатов">
        <div className="chat-list-panel__mobile-header">
          <strong>Чаты</strong>
          <button
            type="button"
            aria-label="Закрыть список чатов"
            onClick={() => setIsMobileListOpen(false)}
          >
            ×
          </button>
        </div>

        <label className="chat-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск"
          />
        </label>

        <div className="chat-list">
          {isChatsLoading && <ChatListSkeleton />}
          {chatsError && (
            <div className="chat-panel-state">
              <p>{chatsError}</p>
              <button type="button" onClick={() => void loadInitialChats()}>
                Повторить
              </button>
            </div>
          )}

          {!isChatsLoading && !chatsError && filteredChats.map((chat) => (
            <button
              type="button"
              className={`chat-list-item${
                chat.id === activeChatId ? ' chat-list-item--active' : ''
              }`}
              key={chat.id}
              onClick={() => selectChat(chat.id)}
            >
              <span className="chat-list-item__main">
                <strong>
                  {chat.contact.name || chat.contact.company || 'Без имени'}
                  {chat.contact.is_deleted ? ' (Удалён)' : ''}
                </strong>
                <small>{chat.last_message || 'Нет сообщений'}</small>
              </span>
              <span className="chat-list-item__meta">
                <time>{formatChatDate(chat.last_message_at)}</time>
                {chat.unread_count > 0 && (
                  <b>{chat.unread_count > 99 ? '99+' : chat.unread_count}</b>
                )}
              </span>
            </button>
          ))}

          {!isChatsLoading
            && !chatsError
            && query.trim()
            && filteredChats.length === 0
            && <p className="chat-list-empty">Чаты не найдены</p>}

          {!query.trim() && (
            <div
              ref={chatListEndRef}
              className="chat-list-pagination-sentinel"
              aria-hidden={!isChatsLoadingMore}
            >
              {isChatsLoadingMore ? 'Загрузка…' : ''}
            </div>
          )}
        </div>
      </aside>

      {isMobileListOpen && (
        <button
          type="button"
          className="chat-mobile-list-backdrop"
          aria-label="Закрыть список чатов"
          onClick={() => setIsMobileListOpen(false)}
        />
      )}

      <article className="chat-dialog">
        <button
          className="chat-mobile-list-toggle"
          type="button"
          aria-label="Открыть список чатов"
          aria-expanded={isMobileListOpen}
          onClick={() => setIsMobileListOpen(true)}
        >
          <span />
          <span />
          <span />
        </button>

        {!isChatsLoading && chats.length === 0 && !chatsError && (
          <EmptyDialog text="Сообщений пока нет" />
        )}
        {!activeChat && chats.length > 0 && (
          <EmptyDialog text="Выберите чат из списка" />
        )}

        {activeChat && (
          <>
            <header className="chat-dialog__header">
              <h1>
                {activeChat.contact.name
                  || activeChat.contact.company
                  || 'Без имени'}
              </h1>
              <div className="chat-menu-wrap">
                <button
                  className="chat-kebab"
                  type="button"
                  aria-label="Меню чата"
                  aria-expanded={isMenuOpen}
                  onClick={() => setIsMenuOpen((value) => !value)}
                >
                  ⋮
                </button>
                {isMenuOpen && (
                  <div className="chat-kebab-menu" role="menu">
                    <button type="button" role="menuitem" onClick={showContact}>
                      Показать контакт
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsDeleteOpen(true)
                        setIsMenuOpen(false)
                      }}
                    >
                      Удалить чат
                    </button>
                  </div>
                )}
              </div>
            </header>

            <div
              className="chat-messages"
              ref={messagesRef}
              onScroll={(event) => {
                if (event.currentTarget.scrollTop < 80 && messages.hasMore) {
                  void loadOlder()
                }
              }}
            >
              {messages.hasMore && (
                <button
                  className="chat-load-older"
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={messages.isLoadingOlder}
                >
                  {messages.isLoadingOlder
                    ? 'Загрузка…'
                    : 'Показать более ранние сообщения'}
                </button>
              )}
              {messages.isLoading && <MessagesSkeleton />}
              {messages.error && (
                <div className="chat-panel-state">
                  <p>{messages.error}</p>
                  <button
                    type="button"
                    onClick={() => setMessagesReloadKey((value) => value + 1)}
                  >
                    Повторить
                  </button>
                </div>
              )}
              {!messages.isLoading && messages.items.map((message) => (
                <MessageBubble message={message} key={message.id} />
              ))}
              {!messages.isLoading
                && !messages.error
                && messages.items.length === 0
                && (
                  <p className="chat-dialog-empty">
                    В этом чате пока нет сообщений
                  </p>
                )}
            </div>

            <footer className="chat-composer">
              {attachment && (
                <PendingChatAttachment
                  file={attachment}
                  disabled={isSending}
                  onRemove={removeAttachment}
                />
              )}
              <input
                ref={fileInputRef}
                className="chat-composer__file-input"
                type="file"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.rtf,.odt,.ods"
                disabled={isSending}
                onChange={handleAttachmentChange}
              />
              <button
                className="chat-composer__attach"
                type="button"
                aria-label="Прикрепить файл"
                disabled={isSending}
                onClick={() => fileInputRef.current?.click()}
              >
                <PaperclipIcon />
              </button>
              <textarea
                ref={inputRef}
                value={draft}
                placeholder="Сообщение"
                maxLength={4096}
                disabled={isSending}
                onChange={(event) => handleDraftChange(event.target.value)}
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void submitMessage()
                  }
                }}
              />
              <button
                type="button"
                aria-label="Отправить сообщение"
                disabled={(!draft.trim() && !attachment) || isSending}
                onClick={() => void submitMessage()}
              >
                <SendIcon />
              </button>
              {sendError && <p role="alert">{sendError}</p>}
            </footer>
          </>
        )}
      </article>

      {isDeleteOpen && (
        <ConfirmModal
          title="Удалить чат?"
          text="Переписка исчезнет из списка. Это действие нельзя отменить."
          onCancel={() => setIsDeleteOpen(false)}
          onConfirm={() => void removeActiveChat()}
        />
      )}

      {contactId && (
        <ContactCard
          contactId={contactId}
          onClose={() => setContactId(null)}
          onEdit={(contact) => {
            setContactId(null)
            setEditingContact(contact)
          }}
          onDeleted={() => {
            setContactId(null)
            void reloadLoadedChats()
          }}
        />
      )}

      {editingContact && (
        <ContactFormModal
          mode="edit"
          contactId={editingContact.id}
          contactName={editingContact.name}
          onClose={() => setEditingContact(null)}
          onCreated={() => undefined}
          onUpdated={() => {
            setEditingContact(null)
            void reloadLoadedChats()
          }}
          onNotFound={() => {
            setEditingContact(null)
            void reloadLoadedChats()
          }}
        />
      )}
    </section>
  )
}

function MessageBubble({ message }: { message: ApiChatMessage }) {
  const parts = message.text.split(urlPattern)

  return (
    <div className={`chat-message-row chat-message-row--${message.sender_type}`}>
      <div className="chat-message">
        {message.attachment && (
          <ChatMessageAttachment attachment={message.attachment} />
        )}
        <p>
          {parts.map((part, index) => (
            part.match(/^https?:\/\//)
              ? (
                  <a
                    href={part}
                    target="_blank"
                    rel="noreferrer"
                    key={`${part}-${index}`}
                  >
                    {part}
                  </a>
                )
              : part
          ))}
        </p>
        <span>
          <time>{formatTime(message.created_at)}</time>
          {message.sender_type === 'user' && (
            <MessageStatus
              status={message.status}
              sentByAi={message.sent_by_ai}
            />
          )}
          {message.sender_type === 'contact' && (
            <small>
              {message.read_at
                ? `Прочитано ${formatTime(message.read_at)}`
                : 'Не прочитано'}
            </small>
          )}
        </span>
      </div>
    </div>
  )
}

function MessageStatus({
  status,
  sentByAi,
}: {
  status: ApiChatMessage['status']
  sentByAi: boolean
}) {
  return (
    <small
      className={status === 'failed' ? 'chat-message-status--failed' : ''}
      title={sentByAi ? 'Отправлено AI' : undefined}
    >
      {sentByAi ? 'AI · ' : ''}
      {status === 'delivered' ? '✓✓' : status === 'failed' ? 'Ошибка' : '✓'}
    </small>
  )
}

function ContactCard({
  contactId,
  onClose,
  onEdit,
  onDeleted,
}: {
  contactId: string
  onClose: () => void
  onEdit: (contact: ApiContact) => void
  onDeleted: () => void
}) {
  const [contact, setContact] = useState<ApiContact | null>(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void getContact(contactId, controller.signal)
      .then(setContact)
      .catch((caughtError) => {
        if (!isAbortError(caughtError)) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Не удалось загрузить контакт.',
          )
        }
      })

    return () => {
      controller.abort()
      deleteControllerRef.current?.abort()
    }
  }, [contactId])

  const share = async () => {
    if (!contact) {
      return
    }
    const text = [contact.name, contact.phone, contact.email, contact.company]
      .filter(Boolean)
      .join('\n')
    if (navigator.share) {
      await navigator.share({ title: contact.name, text }).catch(() => undefined)
    } else {
      await navigator.clipboard.writeText(text).catch(() => undefined)
    }
  }

  const remove = async () => {
    deleteControllerRef.current?.abort()
    const controller = new AbortController()
    deleteControllerRef.current = controller
    try {
      await deleteContact(contactId, controller.signal)
      if (!controller.signal.aborted) {
        onDeleted()
      }
    } catch (caughtError) {
      if (!isAbortError(caughtError)) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Не удалось удалить контакт.',
        )
      }
      setConfirmDelete(false)
    }
  }

  return createPortal(
    <div
      className="chat-modal-backdrop"
      role="presentation"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <article
        className="chat-contact-card"
        role="dialog"
        aria-modal="true"
        aria-label="Карточка контакта"
      >
        <button
          className="chat-contact-card__close"
          type="button"
          aria-label="Закрыть"
          onClick={onClose}
        >
          ×
        </button>
        {!contact && !error && (
          <p className="chat-contact-card__state">Загружаем контакт…</p>
        )}
        {error && (
          <p className="chat-contact-card__state" role="alert">{error}</p>
        )}
        {contact && (
          <>
            <h2>{contact.name}</h2>
            <div className="chat-contact-card__details">
              <p>{contact.phone || 'Телефон не указан'} <small>телефон</small></p>
              <p>{contact.email || 'E-mail не указан'} <small>e-mail</small></p>
              <p>{contact.company || 'Компания не указана'} <small>компания</small></p>
            </div>
            <div className="chat-contact-card__actions">
              <button type="button" onClick={() => void share()}>
                <span>↗</span>Поделиться
              </button>
              <button type="button" onClick={() => onEdit(contact)}>
                <span>✎</span>Изменить
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)}>
                <span>⌫</span>Удалить
              </button>
            </div>
          </>
        )}
        {confirmDelete && (
          <ConfirmModal
            title="Удалить контакт?"
            text="Контакт будет удалён, но история чата сохранится."
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => void remove()}
          />
        )}
      </article>
    </div>,
    document.body,
  )
}

function ConfirmModal({
  title,
  text,
  onCancel,
  onConfirm,
}: {
  title: string
  text: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return createPortal(
    <div className="chat-confirm-backdrop" role="presentation">
      <div className="chat-confirm" role="alertdialog" aria-modal="true">
        <h2>{title}</h2>
        <p>{text}</p>
        <div>
          <button type="button" onClick={onCancel}>Отмена</button>
          <button type="button" onClick={onConfirm}>Удалить</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function EmptyDialog({ text }: { text: string }) {
  return (
    <div className="chat-empty">
      <span><ChatIcon /></span>
      <h2>{text}</h2>
    </div>
  )
}

function ChatListSkeleton() {
  return (
    <>
      {[1, 2, 3, 4].map((item) => (
        <div className="chat-list-skeleton" key={item}>
          <span />
          <i />
        </div>
      ))}
    </>
  )
}

function MessagesSkeleton() {
  return (
    <div className="chat-messages-loading" role="status" aria-label="Загрузка сообщений">
      <span />
      <span />
      <span />
    </div>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3 11 17-8-8 17-2-7-7-2Z" />
      <path d="m10 13 10-10" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 5h20a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H15l-7 5v-5H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" />
    </svg>
  )
}

function sortChats(items: ApiChat[]) {
  return [...items].sort((left, right) => {
    const leftTime = left.last_message_at
      ? new Date(left.last_message_at).getTime()
      : Number.NEGATIVE_INFINITY
    const rightTime = right.last_message_at
      ? new Date(right.last_message_at).getTime()
      : Number.NEGATIVE_INFINITY

    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }
    return right.id.localeCompare(left.id)
  })
}

function uniqueChats(items: ApiChat[]) {
  const unique = new Map<string, ApiChat>()
  items.forEach((chat) => unique.set(chat.id, chat))
  return [...unique.values()]
}

function sortMessages(items: ApiChatMessage[]) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.created_at).getTime()
    const rightTime = new Date(right.created_at).getTime()
    if (leftTime !== rightTime) {
      return leftTime - rightTime
    }
    return left.id.localeCompare(right.id)
  })
}

function uniqueMessages(items: ApiChatMessage[]) {
  const unique = new Map<string, ApiChatMessage>()
  items.forEach((message) => unique.set(message.id, message))
  return [...unique.values()]
}

function rememberMessageIds(
  messages: ApiChatMessage[],
  ids: Set<string>,
  order: string[],
) {
  messages.forEach((message) => {
    if (ids.has(message.id)) {
      return
    }
    ids.add(message.id)
    order.push(message.id)
  })

  while (order.length > MESSAGE_ID_CACHE_SIZE) {
    const oldest = order.shift()
    if (oldest) {
      ids.delete(oldest)
    }
  }
}

function formatChatDate(value: string | null) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (sameLocalDay(date, today)) {
    return formatTime(value)
  }
  if (sameLocalDay(date, yesterday)) {
    return 'Вчера'
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: date.getFullYear() === today.getFullYear() ? undefined : '2-digit',
  }).format(date)
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function sameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
  )
}

function scrollToBottom() {
  const container = document.querySelector<HTMLElement>('.chat-messages')
  if (container) {
    container.scrollTop = container.scrollHeight
  }
}

function isChatAtBottom(container: HTMLElement | null) {
  if (!container) {
    return true
  }
  return container.scrollHeight - container.scrollTop - container.clientHeight <= 80
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
