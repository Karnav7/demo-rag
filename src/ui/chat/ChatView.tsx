import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, Download, Eraser, MoreHorizontal, PanelRight, X } from 'lucide-react'
import type { Conversation, Message } from '../../store/store'
import { useAppStore } from '../../store/StoreProvider'
import { DUR, EASE, useReducedMotion } from '../theme/motion'
import { AnimatePresence, motion } from 'motion/react'
import { Composer, COMPOSER_INPUT_ID } from './Composer'
import { EmptyState } from './EmptyState'
import { MessageView } from './MessageView'
import { dayLabel, sameDay } from './time'
import { usePopover } from './usePopover'
import { EvidencePanel, type EvidenceTab } from '../evidence/EvidencePanel'
import { EvidenceDrawerContext, useDrawerMode } from '../evidence/drawer'
import { useDrawer } from '../shell/useDrawer'
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
  scrolled,
  drawer,
}: {
  conv: Conversation
  /** The conversation has scrolled under the header: it turns translucent glass. */
  scrolled: boolean
  drawer: { narrow: boolean; open: boolean; openerRef: React.RefObject<HTMLButtonElement | null>; onOpen(): void }
}) {
  const { exportConversation, clear } = useAppStore()
  const pop = usePopover('[role="menuitem"]')
  return (
    <header className={`chat__head${scrolled ? ' is-scrolled' : ''}`}>
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

/** A centred day label between hairlines, before the first message of each day (Today, Yesterday, Monday, October 21). */
function DaySeparator({ at }: { at: number }) {
  const label = dayLabel(at)
  return (
    <div className="daysep" role="separator" aria-label={label}>
      <span>{label}</span>
    </div>
  )
}

/** Only turns created after the chat view mounted rise in; history (reloads, conversation switches) appears at rest. */
function MessageList({ messages, since }: { messages: Message[]; since: number }) {
  const reduced = useReducedMotion()
  return (
    <div className="msgs">
      {messages.map((m, i) => (
        <Fragment key={m.id}>
          {(i === 0 || !sameDay(messages[i - 1].createdAt, m.createdAt)) && <DaySeparator at={m.createdAt} />}
          <MessageView message={m} fresh={!reduced && m.createdAt >= since} />
        </Fragment>
      ))}
    </div>
  )
}

export function ChatView() {
  const { conversations, activeId, send, selectedMessageId, highlight, setHighlight, isStreaming, stop } = useAppStore()
  const conv = conversations.find((c) => c.id === activeId)
  const messages = conv?.messages ?? []
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [scrolled, setScrolled] = useState(false)
  /** The reader has scrolled up away from the newest content. */
  const [away, setAway] = useState(false)
  const stick = useRef(true)
  const count = useRef(messages.length)
  const [since] = useState(() => Date.now())

  // Evidence column: tab choice, plus the drawer below 1100 px.
  const narrow = useDrawerMode()
  const [tab, setTab] = useState<EvidenceTab>('graph')
  const drawerRef = useRef<HTMLElement>(null)
  const { shown, show: openDrawer, hide: closeDrawer, openerRef } = useDrawer({
    enabled: narrow,
    focusSelector: '.evidence__close',
    background: () => [...document.querySelectorAll('.chat, .shell__bar, .sb')],
  })

  const selected = messages.find((m) => m.id === selectedMessageId)
  const response = selected && !selected.pending ? (selected.response ?? null) : null
  const sectionId = highlight && highlight.messageId === selectedMessageId ? highlight.sectionId : undefined

  // A citation click (a highlight that changed after mount) reveals the cited passage.
  const lastHighlight = useRef(highlight)
  useEffect(() => {
    if (highlight === lastHighlight.current) return
    lastHighlight.current = highlight
    if (!sectionId) return
    setTab('sources')
    if (narrow) openDrawer()
  }, [highlight, sectionId, narrow, openDrawer])

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

  // The floating dock overlays the conversation: reserve its height at the foot of the scroller.
  useLayoutEffect(() => {
    const dock = dockRef.current
    const chat = chatRef.current
    if (!dock || !chat) return
    const set = () => chat.style.setProperty('--dock-h', `${dock.offsetHeight}px`)
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(dock)
    return () => ro.disconnect()
  }, [])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stick.current = fromBottom < 80
    setScrolled(el.scrollTop > 4)
    setAway(fromBottom > 200)
  }

  const jumpToLatest = () => {
    const el = scrollRef.current
    if (!el) return
    stick.current = true
    setAway(false)
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }

  // Shortcuts: / focuses the question box; Ctrl/⌘+. toggles the evidence drawer (or moves to the evidence
  // tabs when the column is always visible); Esc stops an answer when nothing else claimed the key.
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) {
        e.preventDefault()
        document.getElementById(COMPOSER_INPUT_ID)?.focus()
      } else if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault()
        if (narrow) (shown ? closeDrawer : openDrawer)()
        else document.querySelector<HTMLElement>('.ev__tab[aria-selected="true"]')?.focus()
      } else if (e.key === 'Escape' && isStreaming && !e.defaultPrevented) {
        e.preventDefault()
        stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [narrow, shown, openDrawer, closeDrawer, isStreaming, stop])

  return (
    <div className="chat-route">
      <section className="chat" aria-label="Chat" ref={chatRef}>
        <div className="chat__scroll" ref={scrollRef} onScroll={onScroll}>
          {conv && messages.length > 0 && (
            <ChatHeader conv={conv} scrolled={scrolled} drawer={{ narrow, open: shown, openerRef, onOpen: openDrawer }} />
          )}
          {conv && messages.length > 0 ? (
            <EvidenceDrawerContext.Provider value={{ show: () => narrow && openDrawer() }}>
              <MessageList messages={messages} since={since} />
            </EvidenceDrawerContext.Provider>
          ) : (
            <EmptyState onAsk={(q) => void send(q)} />
          )}
        </div>
        <div className="chat__dock" ref={dockRef}>
          <AnimatePresence>
            {away && messages.length > 0 && (
              <motion.button
                type="button"
                className="pill chat__jump"
                onClick={jumpToLatest}
                initial={reduced ? false : { opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduced ? undefined : { opacity: 0, y: 6 }}
                transition={{ duration: DUR.fast, ease: EASE }}
              >
                {isStreaming && <span className="chat__jump-dot" aria-hidden />}
                <ArrowDown size={13} aria-hidden /> Jump to latest
              </motion.button>
            )}
          </AnimatePresence>
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
        <EvidencePanel
          response={response}
          tab={tab}
          onTab={setTab}
          highlightSectionId={sectionId}
          pending={!!selected?.pending}
          onOpenSection={(s) => selectedMessageId && setHighlight({ messageId: selectedMessageId, sectionId: s })}
        />
      </aside>
    </div>
  )
}
