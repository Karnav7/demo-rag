import { useSyncExternalStore } from 'react'
import { createClient, type ChatClient } from '../client/chatClient'
import type { ChatRequest, ChatResponse, Settings, Source, TraceStage } from '../domain/types'
import { storage } from './storage'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  response?: ChatResponse
  pending?: boolean
  stages?: TraceStage[]
  vote?: 'up' | 'down' | null
}
export interface Conversation { id: string; title: string; createdAt: number; updatedAt: number; messages: Message[] }
export type GroupLabel = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older'

export const CONVERSATIONS_KEY = 'dummy-rag.conversations'
export const SETTINGS_KEY = 'dummy-rag.settings'
export const DEFAULT_SETTINGS: Settings = { source: 'offline', mode: 'hybrid', useContext: true, generateAnswer: true }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isMessage = (v: unknown): v is Message =>
  isObj(v) && typeof v.id === 'string' && (v.role === 'user' || v.role === 'assistant') &&
  typeof v.text === 'string' && typeof v.createdAt === 'number'
const isConversation = (v: unknown): v is Conversation =>
  isObj(v) && typeof v.id === 'string' && typeof v.title === 'string' &&
  typeof v.createdAt === 'number' && typeof v.updatedAt === 'number' &&
  Array.isArray(v.messages) && v.messages.every(isMessage)
const isConversations = (v: unknown): v is Conversation[] => Array.isArray(v) && v.every(isConversation)
const isSettings = (v: unknown): v is Settings =>
  isObj(v) && (v.source === 'live' || v.source === 'offline') &&
  ['lexical', 'vector', 'hybrid', 'graph'].includes(v.mode as string) &&
  typeof v.useContext === 'boolean' && typeof v.generateAnswer === 'boolean'

export interface StoreState {
  conversations: Conversation[]
  activeId: string | null
  settings: Settings
  /** Effective selection: the explicit pick if still valid, else the latest assistant message of the active conversation. */
  selectedMessageId: string | null
  newConversation(): string
  select(id: string): void
  rename(id: string, title: string): void
  remove(id: string): void
  clear(id: string): void
  send(text: string): Promise<void>
  regenerate(messageId: string): Promise<void>
  vote(messageId: string, v: 'up' | 'down' | null): void
  selectMessage(id: string | null): void
  patchSettings(p: Partial<Settings>): void
  exportConversation(id: string): string
  search(q: string): Conversation[]
  grouped(now?: number): { label: GroupLabel; items: Conversation[] }[]
}
export type AppStore = {
  getState(): StoreState
  subscribe(listener: () => void): () => void
}

let counter = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

function loadConversations(): Conversation[] {
  const list = storage.get<Conversation[]>(CONVERSATIONS_KEY, [], isConversations)
  return list.map((c) => ({ ...c, messages: c.messages.map((m) => (m.pending ? { ...m, pending: false } : m)) }))
}

export function createStore(opts: { clientFor?: (s: Source) => ChatClient; now?: () => number } = {}): AppStore {
  const clientFor = opts.clientFor ?? createClient
  const now = opts.now ?? Date.now
  const listeners = new Set<() => void>()

  let conversations = loadConversations()
  let activeId: string | null = null
  let settings = storage.get<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS, isSettings)
  let explicitSelected: string | null = null
  let inflight: { ctrl: AbortController; convId: string; msgId: string } | null = null
  let state: StoreState

  function derive(): StoreState {
    const active = conversations.find((c) => c.id === activeId)
    let sel: string | null = null
    if (active) {
      if (explicitSelected && active.messages.some((m) => m.id === explicitSelected && m.role === 'assistant')) sel = explicitSelected
      else sel = [...active.messages].reverse().find((m) => m.role === 'assistant')?.id ?? null
    }
    return { ...actions, conversations, activeId, settings, selectedMessageId: sel }
  }
  function emit(persist: 'all' | 'none' = 'all') {
    if (persist === 'all') {
      storage.set(CONVERSATIONS_KEY, conversations)
      storage.set(SETTINGS_KEY, settings)
    }
    state = derive()
    listeners.forEach((l) => l())
  }

  const updateConv = (id: string, fn: (c: Conversation) => Conversation) => {
    conversations = conversations.map((c) => (c.id === id ? fn(c) : c))
  }
  const updateMsg = (convId: string, msgId: string, fn: (m: Message) => Message) =>
    updateConv(convId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId ? fn(m) : m)) }))

  /** Abort the running stream (if any, optionally only for a given conversation) and settle its message. */
  function abort(onlyConv?: string) {
    if (!inflight || (onlyConv && inflight.convId !== onlyConv)) return
    const { ctrl, convId, msgId } = inflight
    inflight = null
    ctrl.abort()
    updateMsg(convId, msgId, (m) => ({ ...m, pending: false }))
  }

  async function stream(convId: string, msgId: string, req: ChatRequest) {
    abort()
    const ctrl = new AbortController()
    const mine = { ctrl, convId, msgId }
    inflight = mine
    const live = () => inflight === mine && !ctrl.signal.aborted
    const settle = (fn: (m: Message) => Message, persist: 'all' | 'none' = 'all') => {
      updateMsg(convId, msgId, fn)
      emit(persist)
    }
    try {
      for await (const ev of clientFor(req.settings.source).chat(req, ctrl.signal)) {
        if (!live()) return
        if (ev.type === 'stage') settle((m) => ({ ...m, stages: [...(m.stages ?? []), ev.stage] }), 'none')
        else if (ev.type === 'token') settle((m) => ({ ...m, text: m.text + ev.text }), 'none')
        else if (ev.type === 'done') {
          settle((m) => ({ ...m, response: ev.response, text: ev.response.answer, pending: false }))
          inflight = null
          return
        } else if (ev.type === 'error') {
          settle((m) => ({ ...m, pending: false, text: `Something went wrong: ${ev.message}` }))
          inflight = null
          return
        }
      }
    } catch (e) {
      if (live()) {
        settle((m) => ({ ...m, pending: false, text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` }))
        inflight = null
      }
      return
    }
    if (live()) { // iterator ended without done/error
      settle((m) => ({ ...m, pending: false }))
      inflight = null
    }
  }

  function startAnswer(convId: string, question: string, history: ChatRequest['history'], msgId: string) {
    const req: ChatRequest = { question, history, settings: { ...settings } }
    return stream(convId, msgId, req)
  }

  const actions = {
    newConversation() {
      const empty = conversations.find((c) => c.id === activeId && c.messages.length === 0)
      if (empty) return empty.id
      const t = now()
      const c: Conversation = { id: uid('c'), title: 'New conversation', createdAt: t, updatedAt: t, messages: [] }
      conversations = [c, ...conversations]
      activeId = c.id
      explicitSelected = null
      emit()
      return c.id
    },
    select(id: string) {
      if (!conversations.some((c) => c.id === id) || id === activeId) return
      abort()
      activeId = id
      explicitSelected = null
      emit()
    },
    rename(id: string, title: string) {
      const t = title.trim()
      if (!t) return
      updateConv(id, (c) => ({ ...c, title: t }))
      emit()
    },
    remove(id: string) {
      abort(id)
      conversations = conversations.filter((c) => c.id !== id)
      if (activeId === id) { activeId = conversations[0]?.id ?? null; explicitSelected = null }
      emit()
    },
    clear(id: string) {
      abort(id)
      updateConv(id, (c) => ({ ...c, messages: [], updatedAt: now() }))
      if (activeId === id) explicitSelected = null
      emit()
    },
    async send(text: string) {
      const q = text.trim()
      if (!q) return
      abort()
      if (!activeId || !conversations.some((c) => c.id === activeId)) actions.newConversation()
      const convId = activeId as string
      const conv = conversations.find((c) => c.id === convId)!
      const history = conv.messages.map((m) => ({ role: m.role, text: m.text }))
      const t = now()
      const user: Message = { id: uid('m'), role: 'user', text: q, createdAt: t }
      const asst: Message = { id: uid('m'), role: 'assistant', text: '', createdAt: t, pending: true, stages: [], vote: null }
      updateConv(convId, (c) => ({
        ...c,
        title: c.messages.length === 0 ? q.slice(0, 48) : c.title,
        updatedAt: t,
        messages: [...c.messages, user, asst],
      }))
      explicitSelected = null
      emit()
      await startAnswer(convId, q, history, asst.id)
    },
    async regenerate(messageId: string) {
      const conv = conversations.find((c) => c.messages.some((m) => m.id === messageId))
      if (!conv) return
      const i = conv.messages.findIndex((m) => m.id === messageId)
      const prev = conv.messages[i - 1]
      if (conv.messages[i].role !== 'assistant' || !prev || prev.role !== 'user') return
      abort()
      const history = conv.messages.slice(0, i - 1).map((m) => ({ role: m.role, text: m.text }))
      updateMsg(conv.id, messageId, (m) => ({
        id: m.id, role: 'assistant', createdAt: m.createdAt, text: '', pending: true, stages: [], vote: null,
      }))
      updateConv(conv.id, (c) => ({ ...c, updatedAt: now() }))
      emit()
      await startAnswer(conv.id, prev.text, history, messageId)
    },
    vote(messageId: string, v: 'up' | 'down' | null) {
      const conv = conversations.find((c) => c.messages.some((m) => m.id === messageId))
      if (!conv) return
      updateMsg(conv.id, messageId, (m) => ({ ...m, vote: v }))
      emit()
    },
    selectMessage(id: string | null) {
      explicitSelected = id
      emit('none')
    },
    patchSettings(p: Partial<Settings>) {
      settings = { ...settings, ...p }
      emit()
    },
    exportConversation(id: string) {
      const c = conversations.find((x) => x.id === id)
      return JSON.stringify(
        { title: c?.title ?? '', exportedAt: new Date(now()).toISOString(), messages: (c?.messages ?? []).map((m) => ({ role: m.role, text: m.text, response: m.response ?? null })) },
        null, 2,
      )
    },
    search(q: string) {
      const n = q.trim().toLowerCase()
      if (!n) return conversations
      return conversations.filter((c) => c.title.toLowerCase().includes(n) || c.messages.some((m) => m.text.toLowerCase().includes(n)))
    },
    grouped(at: number = now()) {
      const today = startOfDay(at)
      const DAY = 86_400_000
      const labels: GroupLabel[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older']
      const buckets: Record<GroupLabel, Conversation[]> = { Today: [], Yesterday: [], 'Previous 7 days': [], Older: [] }
      for (const c of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
        const u = c.updatedAt
        const label: GroupLabel = u >= today ? 'Today' : u >= today - DAY ? 'Yesterday' : u >= today - 7 * DAY ? 'Previous 7 days' : 'Older'
        buckets[label].push(c)
      }
      return labels.filter((l) => buckets[l].length).map((label) => ({ label, items: buckets[label] }))
    },
  }

  state = derive()
  return {
    getState: () => state,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l) } },
  }
}

/** App-wide singleton. */
export const store = createStore()

export function useStore(): StoreState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
