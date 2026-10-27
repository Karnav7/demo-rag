import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, CONVERSATIONS_KEY, DEFAULT_SETTINGS, type Conversation } from './store'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

const Q = 'Who is the ultimate beneficial owner of Meridian?'
const msgs = (s: ReturnType<typeof createStore>, id: string) => s.getState().conversations.find((c) => c.id === id)!.messages

describe('store', () => {
  it('corrupt persisted JSON falls back to defaults', () => {
    localStorage.setItem(CONVERSATIONS_KEY, '{oops')
    localStorage.setItem('dummy-rag.settings', '"junk"')
    const s = createStore()
    expect(s.getState().conversations).toEqual([])
    expect(s.getState().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('localStorage throwing on set does not break send', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const s = createStore()
    const p = s.getState().send(Q)
    await vi.runAllTimersAsync()
    await p
    const c = s.getState().conversations[0]
    expect(c.messages[1].pending).toBe(false)
    expect(c.messages[1].response).toBeTruthy()
  })

  it('whitespace send is ignored', async () => {
    const s = createStore()
    await s.getState().send('   ')
    expect(s.getState().conversations).toEqual([])
  })

  it('streams into the assistant message, titles, persists, and reloads non-pending', async () => {
    const s = createStore()
    const p = s.getState().send(Q)
    expect(msgs(s, s.getState().activeId!)[1].pending).toBe(true)
    await vi.runAllTimersAsync()
    await p
    const c = s.getState().conversations[0]
    expect(c.title).toBe(Q.slice(0, 48))
    expect(c.messages[1].text).toBe(c.messages[1].response!.answer)
    expect(c.messages[1].stages!.length).toBeGreaterThan(0)
    expect(s.getState().selectedMessageId).toBe(c.messages[1].id)
    const saved: Conversation[] = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!)
    expect(saved[0].messages[1].response).toBeTruthy()
    // pending state in storage is neutralised on load
    saved[0].messages[1].pending = true
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(saved))
    expect(createStore().getState().conversations[0].messages[1].pending).toBe(false)
  })

  it('switching conversation mid-stream aborts and leaks nothing', async () => {
    const s = createStore()
    const A = s.getState().newConversation()
    const pA = s.getState().send(Q)
    // create B via a second store action while A streams
    const B = s.getState().newConversation()
    expect(B).not.toBe(A)
    const before = JSON.stringify(msgs(s, B))
    s.getState().select(A)
    s.getState().select(B)
    await vi.runAllTimersAsync()
    await pA
    expect(JSON.stringify(msgs(s, B))).toBe(before)
    const am = msgs(s, A)
    expect(am[1].pending).toBe(false)
    expect(am[1].response).toBeUndefined()
  })

  it('deleting the active streaming conversation aborts', async () => {
    const s = createStore()
    const p = s.getState().send(Q)
    const id = s.getState().activeId!
    s.getState().remove(id)
    await vi.runAllTimersAsync()
    await p
    expect(s.getState().conversations).toEqual([])
    expect(s.getState().activeId).toBeNull()
  })

  it('regenerate replaces in place', async () => {
    const s = createStore()
    const p = s.getState().send(Q)
    await vi.runAllTimersAsync()
    await p
    const id = s.getState().activeId!
    const before = msgs(s, id)[1]
    const r = s.getState().regenerate(before.id)
    expect(msgs(s, id)[1].pending).toBe(true)
    await vi.runAllTimersAsync()
    await r
    const after = msgs(s, id)
    expect(after).toHaveLength(2)
    expect(after[1].id).toBe(before.id)
    expect(after[1].response).not.toBe(before.response)
    expect(after[1].response!.answer).toBe(before.response!.answer)
  })

  it('grouped buckets by date', () => {
    const now = new Date(2026, 9, 27, 15).getTime()
    const day = 86_400_000
    const mk = (id: string, at: number) => ({ id, title: id, createdAt: at, updatedAt: at, messages: [] })
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify([
      mk('t', now - 1000), mk('y', now - day), mk('w', now - 4 * day), mk('o', now - 30 * day),
    ]))
    const g = createStore().getState().grouped(now)
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([
      ['Today', ['t']], ['Yesterday', ['y']], ['Previous 7 days', ['w']], ['Older', ['o']],
    ])
  })

  it('search matches title and message text, case-insensitive', async () => {
    const s = createStore()
    const p = s.getState().send(Q)
    await vi.runAllTimersAsync()
    await p
    s.getState().newConversation()
    expect(s.getState().search('MERIDIAN')).toHaveLength(1)
    expect(s.getState().search('zzzz-nope')).toHaveLength(0)
  })

  it('export round-trips through JSON.parse; clear keeps the conversation', async () => {
    const s = createStore()
    const p = s.getState().send(Q)
    await vi.runAllTimersAsync()
    await p
    const id = s.getState().activeId!
    const out = JSON.parse(s.getState().exportConversation(id))
    expect(out.title).toBe(Q.slice(0, 48))
    expect(out.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
    expect(typeof out.exportedAt).toBe('string')
    s.getState().clear(id)
    expect(msgs(s, id)).toEqual([])
  })

  it('history excludes the in-flight assistant message', async () => {
    const seen: number[] = []
    const s2 = createStore({
      clientFor: () => ({ async *chat(req) { seen.push(req.history.length); yield { type: 'error' as const, message: 'boom' } } }),
    })
    await s2.getState().send('one')
    await s2.getState().send('two')
    expect(seen).toEqual([0, 2])
    expect(msgs(s2, s2.getState().activeId!)[3].text).toBe('Something went wrong: boom')
  })
})
