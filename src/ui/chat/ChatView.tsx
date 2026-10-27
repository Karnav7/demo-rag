import { useEffect, useLayoutEffect, useRef } from 'react'
import { Download, Eraser, MoreHorizontal } from 'lucide-react'
import type { Conversation, Message } from '../../store/store'
import { useAppStore } from '../../store/StoreProvider'
import { useReducedMotion } from '../theme/motion'
import { Composer, COMPOSER_INPUT_ID } from './Composer'
import { EmptyState } from './EmptyState'
import { MessageView } from './MessageView'
import { usePopover } from './usePopover'
import './chat.css'

const fileName = (title: string) => (title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'conversation') + '.json'

function download(name: string, json: string) {
  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch {
    /* no Blob URLs (e.g. tests): nothing to download */
  }
}

function ChatHeader({ conv }: { conv: Conversation }) {
  const { exportConversation, clear } = useAppStore()
  const pop = usePopover('[role="menuitem"]')
  return (
    <header className="chat__head">
      <h2 className="chat__title" title={conv.title}>{conv.title}</h2>
      <div className="chat__menu" ref={pop.rootRef}>
        <button
          ref={pop.triggerRef}
          type="button"
          className="act"
          aria-label="Conversation options"
          aria-haspopup="menu"
          aria-expanded={pop.open}
          onClick={pop.toggle}
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
        {pop.open && (
          <div ref={pop.popRef} className="menu" role="menu" aria-label="Conversation" onKeyDown={pop.onPopKeyDown}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                download(fileName(conv.title), exportConversation(conv.id))
                pop.close()
              }}
            >
              <Download size={14} aria-hidden />
              <span className="menu__text">
                <span>Export conversation</span>
                <span className="menu__hint">JSON with evidence</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                pop.close(false)
                clear(conv.id)
                document.getElementById(COMPOSER_INPUT_ID)?.focus()
              }}
            >
              <Eraser size={14} aria-hidden />
              <span className="menu__text">
                <span>Clear conversation</span>
                <span className="menu__hint">Keeps the thread, removes messages</span>
              </span>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

/** Messages already present when the list mounted (e.g. on conversation switch) appear without the rise. */
function MessageList({ messages }: { messages: Message[] }) {
  const reduced = useReducedMotion()
  const initial = useRef(new Set(messages.map((m) => m.id)))
  return (
    <div className="msgs">
      {messages.map((m) => (
        <MessageView key={m.id} message={m} fresh={!reduced && !initial.current.has(m.id)} />
      ))}
    </div>
  )
}

export function ChatView() {
  const { conversations, activeId, send } = useAppStore()
  const conv = conversations.find((c) => c.id === activeId)
  const messages = conv?.messages ?? []
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const count = useRef(messages.length)

  // Follow the stream while the reader is at the bottom; a new turn always scrolls into view.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (messages.length > count.current) stick.current = true
    count.current = messages.length
    if (stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    stick.current = true
  }, [activeId])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  return (
    <div className="chat-route">
      <section className="chat" aria-label="Chat">
        {conv && messages.length > 0 && <ChatHeader conv={conv} />}
        <div className="chat__scroll" ref={scrollRef} onScroll={onScroll}>
          {conv && messages.length > 0 ? (
            <MessageList key={conv.id} messages={messages} />
          ) : (
            <EmptyState onAsk={(q) => void send(q)} />
          )}
        </div>
        <div className="chat__dock">
          <Composer />
          {messages.length > 0 && (
            <p className="chat__fine">Fictional data for demonstration. Not financial or legal advice.</p>
          )}
        </div>
      </section>
      {/* Evidence column slot: Task 10 fills it (and turns it into a drawer below 1100 px). */}
      <aside className="evidence" aria-label="Evidence">
        <p className="evidence__empty">Ask a question to see its evidence.</p>
      </aside>
    </div>
  )
}
