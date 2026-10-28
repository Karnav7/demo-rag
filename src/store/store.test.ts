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

  const hangingClient = (signals: AbortSignal[]) => ({
    clientFor: () => ({
      async *chat(_req: unknown, signal: AbortSignal) {
        signals.push(signal)
        yield { type: 'token' as const, text: 'partial ' }
        await new Promise<void>((res) => signal.addEventListener('abort', () => res()))
        yield { type: 'token' as const, text: 'LEAK' }
      },
    }),
  })

  it.each(['select', 'newConversation'] as const)('switching away via %s mid-stream aborts and leaks nothing', async (how) => {
    const signals: AbortSignal[] = []
    const s = createStore(hangingClient(signals))
    const B = s.getState().newConversation()
    const A = s.getState().newConversation()
    // newConversation reuses the empty active B; make B non-empty for a distinct target
    expect(A).toBe(B)
    const bId = B
    s.getState().select(bId)
    const pB = s.getState().send('first in B')
    await vi.advanceTimersByTimeAsync(0)
    s.getState().newConversation() // abort B's stream, create A
    await pB
    const aId = s.getState().activeId!
    expect(aId).not.toBe(bId)
    const pA = s.getState().send('question in A')
    await vi.advanceTimersByTimeAsync(0)
    if (how === 'select') s.getState().select(bId)
    else s.getState().newConversation()
    const other = s.getState().activeId!
    const before = JSON.stringify(msgs(s, other))
    await pA
    await vi.runAllTimersAsync()
    expect(signals[signals.length - 1].aborted).toBe(true)
    expect(JSON.stringify(msgs(s, other))).toBe(before)
    const am = msgs(s, aId)[1]
    expect(am.pending).toBe(false)
    expect(am.text).toBe('partial ')
  })

  it('malformed persisted shapes drop only the bad conversations', () => {
    const base = { createdAt: 1, updatedAt: 1 }
    const m = (extra: object) => ({ id: 'm', role: 'assistant', text: 't', createdAt: 1, ...extra })
    const okResp = { answer: 'a', citations: [], facts: [], sources: [], cypher: [], trace: [], subgraph: { nodes: [], edges: [] } }
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify([
      { id: 'good', title: 'g', ...base, messages: [m({ response: okResp, stages: [], vote: 'up' })] },
      { id: 'r1', title: 'x', ...base, messages: [m({ response: 'x' })] },
      { id: 'r2', title: 'x', ...base, messages: [m({ response: {} })] },
      { id: 'r3', title: 'x', ...base, messages: [m({ response: { ...okResp, subgraph: {} } })] },
      { id: 'r4', title: 'x', ...base, messages: [m({ stages: 'no' })] },
      { id: 'r5', title: 'x', ...base, messages: [m({ vote: 'sideways' })] },
    ]))
    expect(createStore().getState().conversations.map((c) => c.id)).toEqual(['good'])
  })

  it('deleting the active streaming conversation aborts', async () => {
    const signals: AbortSignal[] = []
    const s = createStore(hangingClient(signals))
    const p = s.getState().send(Q)
    await vi.advanceTimersByTimeAsync(0)
    s.getState().remove(s.getState().activeId!)
    await p
    expect(signals[0].aborted).toBe(true)
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
  it('highlight is set, not persisted, and resets on conversation switch and clear', async () => {
    const s = createStore()
    const p = s.getState().send(Q)
    await vi.runAllTimersAsync()
    await p
    const first = s.getState().activeId!
    const asst = msgs(s, first)[1]
    expect(s.getState().highlight).toBeNull()
    s.getState().setHighlight({ messageId: asst.id, sectionId: 'sec-x' })
    expect(s.getState().highlight).toEqual({ messageId: asst.id, sectionId: 'sec-x' })
    expect(localStorage.getItem(CONVERSATIONS_KEY)).not.toContain('sec-x')
    s.getState().newConversation()
    expect(s.getState().highlight).toBeNull()
    s.getState().select(first)
    s.getState().setHighlight({ messageId: asst.id, sectionId: 'sec-x' })
    s.getState().clear(first)
    expect(s.getState().highlight).toBeNull()
  })

  describe('stop and streaming state', () => {
    const hanging = (signals: AbortSignal[]) => ({
      clientFor: () => ({
        async *chat(_req: unknown, signal: AbortSignal) {
          signals.push(signal)
          yield { type: 'token' as const, text: 'partial ' }
          await new Promise<void>((res) => signal.addEventListener('abort', () => res()))
        },
      }),
    })

    it('reports streaming while an answer arrives, and not after it completes', async () => {
      const s = createStore()
      expect(s.getState().isStreaming).toBe(false)
      const p = s.getState().send(Q)
      expect(s.getState().isStreaming).toBe(true)
      await vi.runAllTimersAsync()
      await p
      expect(s.getState().isStreaming).toBe(false)
    })

    it('stop() aborts, keeps the partial text and marks the answer stopped', async () => {
      const signals: AbortSignal[] = []
      const s = createStore(hanging(signals))
      void s.getState().send(Q)
      await vi.advanceTimersByTimeAsync(0)
      s.getState().stop()
      const a = msgs(s, s.getState().activeId!)[1]
      expect(signals[0].aborted).toBe(true)
      expect(s.getState().isStreaming).toBe(false)
      expect(a).toMatchObject({ pending: false, stopped: true, text: 'partial ' })
      expect(a.completedAt).toEqual(expect.any(Number))
    })

    it('a completed answer is never marked stopped', async () => {
      const s = createStore()
      const p = s.getState().send(Q)
      await vi.runAllTimersAsync()
      await p
      expect(msgs(s, s.getState().activeId!)[1].stopped).toBeUndefined()
    })

    it('a settled answer records when it finished, after it was asked', async () => {
      let t = 1_000
      const s = createStore({ now: () => (t += 500) })
      const p = s.getState().send(Q)
      await vi.runAllTimersAsync()
      await p
      const [u, a] = msgs(s, s.getState().activeId!)
      expect(u.completedAt).toBeUndefined()
      expect(a.completedAt).toBeGreaterThan(a.createdAt)
    })

    it('an answer interrupted by a reload comes back marked stopped', () => {
      const saved = [{ id: 'c', title: 't', createdAt: 1, updatedAt: 1, messages: [
        { id: 'u', role: 'user', text: 'q', createdAt: 1 },
        { id: 'a', role: 'assistant', text: 'half', createdAt: 1, pending: true },
      ] }]
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(saved))
      expect(createStore().getState().conversations[0].messages[1]).toMatchObject({ pending: false, stopped: true })
    })
  })
})
