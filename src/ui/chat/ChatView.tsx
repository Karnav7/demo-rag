import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Download, Eraser, MoreHorizontal, PanelRight, X } from 'lucide-react'
import type { Conversation, Message } from '../../store/store'
import { useAppStore } from '../../store/StoreProvider'
import { useReducedMotion } from '../theme/motion'
import { Composer, COMPOSER_INPUT_ID } from './Composer'
import { EmptyState } from './EmptyState'
import { MessageView } from './MessageView'
import { usePopover } from './usePopover'
import { EvidencePanel, type EvidenceTab } from '../evidence/EvidencePanel'
import { EvidenceDrawerContext, useDrawerMode } from '../evidence/drawer'
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

function ChatHeader({
  conv,
  drawer,
}: {
  conv: Conversation
  drawer: { narrow: boolean; open: boolean; openerRef: React.RefObject<HTMLButtonElement | null>; onOpen(): void }
}) {
  const { exportConversation, clear } = useAppStore()
  const pop = usePopover('[role="menuitem"]')
  return (
    <header className="chat__head">
      <h2 className="chat__title" title={conv.title}>{conv.title}</h2>
      {drawer.narrow && (
        <button
          ref={drawer.openerRef}
          type="button"
          className="pill chat__evidence"
          aria-expanded={drawer.open}
          onClick={drawer.onOpen}
        >
          <PanelRight size={14} aria-hidden /> Show evidence
        </button>
      )}
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

/** Only turns created after the chat view mounted rise in; history (reloads, conversation switches) appears at rest. */
function MessageList({ messages, since }: { messages: Message[]; since: number }) {
  const reduced = useReducedMotion()
  return (
    <div className="msgs">
      {messages.map((m) => (
        <MessageView key={m.id} message={m} fresh={!reduced && m.createdAt >= since} />
      ))}
    </div>
  )
}

export function ChatView() {
  const { conversations, activeId, send, selectedMessageId, highlight } = useAppStore()
  const conv = conversations.find((c) => c.id === activeId)
  const messages = conv?.messages ?? []
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const count = useRef(messages.length)
  const [since] = useState(() => Date.now())

  // Evidence column: tab choice, plus the drawer below 1100 px.
  const narrow = useDrawerMode()
  const [tab, setTab] = useState<EvidenceTab>('graph')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const shown = narrow && drawerOpen

  const selected = messages.find((m) => m.id === selectedMessageId)
  const response = selected && !selected.pending ? (selected.response ?? null) : null
  const sectionId = highlight && highlight.messageId === selectedMessageId ? highlight.sectionId : undefined

  // A citation click reveals the cited passage.
  useEffect(() => {
    if (sectionId) {
      setTab('sources')
      if (narrow) openDrawer()
    }
  }, [highlight])

  function openDrawer() {
    if (!drawerOpen) returnTo.current = (document.activeElement as HTMLElement | null) ?? null
    setDrawerOpen(true)
  }
  const closeDrawer = () => setDrawerOpen(false)

  const wasShown = useRef(false)
  useEffect(() => {
    if (shown) drawerRef.current?.querySelector<HTMLElement>('.evidence__close')?.focus()
    else if (wasShown.current) {
      const back = returnTo.current?.isConnected ? returnTo.current : openerRef.current
      back?.focus()
    }
    wasShown.current = shown
  }, [shown])

  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeDrawer()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shown])

  useEffect(() => {
    if (!narrow) setDrawerOpen(false)
  }, [narrow])

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
        {conv && messages.length > 0 && <ChatHeader conv={conv} drawer={{ narrow, open: shown, openerRef, onOpen: openDrawer }} />}
        <div className="chat__scroll" ref={scrollRef} onScroll={onScroll}>
          {conv && messages.length > 0 ? (
            <EvidenceDrawerContext.Provider value={{ show: () => narrow && openDrawer() }}>
              <MessageList messages={messages} since={since} />
            </EvidenceDrawerContext.Provider>
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
      <div className={`evidence__scrim${shown ? ' is-open' : ''}`} onClick={closeDrawer} aria-hidden />
      <aside
        ref={drawerRef}
        className={`evidence${shown ? ' evidence--open' : ''}`}
        aria-label="Evidence"
        role={narrow ? 'dialog' : undefined}
        aria-modal={shown ? true : undefined}
        inert={narrow && !shown}
      >
        {narrow && (
          <button type="button" className="act evidence__close" aria-label="Close evidence" onClick={closeDrawer}>
            <X size={16} aria-hidden />
          </button>
        )}
        <EvidencePanel response={response} tab={tab} onTab={setTab} highlightSectionId={sectionId} />
      </aside>
    </div>
  )
}
