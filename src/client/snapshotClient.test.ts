import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as pipeline from '../engine/pipeline'
import { createClient, isLiveSimulated } from './chatClient'
import type { ChatEvent, ChatRequest, Source } from '../domain/types'

const req = (source: Source): ChatRequest => ({
  question: 'Who is the ultimate beneficial owner of Meridian?',
  history: [],
  settings: { source, mode: 'hybrid', useContext: true, generateAnswer: true },
})

async function collect(source: Source, signal = new AbortController().signal): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  const run = (async () => { for await (const e of createClient(source).chat(req(source), signal)) events.push(e) })()
  await vi.runAllTimersAsync()
  await run
  return events
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('SnapshotChatClient', () => {
  it('emits stages then tokens then done', async () => {
    const events = await collect('offline')
    const types = events.map((e) => e.type)
    const firstToken = types.indexOf('token')
    expect(types[0]).toBe('stage')
    expect(types.lastIndexOf('stage')).toBeLessThan(firstToken)
    expect(types.lastIndexOf('token')).toBeLessThan(types.indexOf('done'))
    expect(types.at(-1)).toBe('done')
    expect(types).not.toContain('error')
    const done = events.at(-1)
    if (done?.type !== 'done') throw new Error('no done')
    const stageMs = events.flatMap((e) => (e.type === 'stage' ? [e.stage.ms] : []))
    expect(stageMs.every((ms) => ms >= 40 && ms <= 120)).toBe(true)
    expect(done.response.trace.map((s) => s.ms)).toEqual(stageMs)
    expect(done.response.stats.totalMs).toBe(stageMs.reduce((a, b) => a + b, 0))
  })

  it('token concatenation equals response.answer', async () => {
    const events = await collect('offline')
    const text = events.flatMap((e) => (e.type === 'token' ? [e.text] : [])).join('')
    const done = events.at(-1)
    if (done?.type !== 'done') throw new Error('no done')
    expect(done.response.answer.length).toBeGreaterThan(0)
    expect(text).toBe(done.response.answer)
  })

  it('live slower than offline', async () => {
    const total = async (s: Source) => {
      const done = (await collect(s)).at(-1)
      if (done?.type !== 'done') throw new Error('no done')
      return done.response.stats.totalMs
    }
    expect(await total('live')).toBeGreaterThan(await total('offline'))
  })

  it('abort mid-stream yields no further events', async () => {
    const ac = new AbortController()
    const events: ChatEvent[] = []
    const run = (async () => {
      for await (const e of createClient('offline').chat(req('offline'), ac.signal)) {
        events.push(e)
        if (events.length === 2) ac.abort()
      }
    })()
    await vi.runAllTimersAsync()
    await run
    expect(events).toHaveLength(2)
    expect(events.some((e) => e.type === 'error' || e.type === 'done')).toBe(false)
  })
})

describe('SnapshotChatClient edge cases', () => {
  it('emits a single error event when the pipeline throws', async () => {
    vi.spyOn(pipeline, 'runPipeline').mockImplementation(() => { throw new Error('boom') })
    const events = await collect('offline')
    expect(events).toEqual([{ type: 'error', message: 'boom' }])
    vi.restoreAllMocks()
  })

  it('abort before start yields no events', async () => {
    const ac = new AbortController()
    ac.abort()
    expect(await collect('offline', ac.signal)).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('abort during a token wait yields nothing further and leaves no timers', async () => {
    const ac = new AbortController()
    const events: ChatEvent[] = []
    const run = (async () => {
      for await (const e of createClient('offline').chat(req('offline'), ac.signal)) events.push(e)
    })()
    for (let i = 0; i < 200 && !events.some((e) => e.type === 'token'); i++) await vi.advanceTimersByTimeAsync(10)
    const n = events.length
    ac.abort()
    await run
    expect(events).toHaveLength(n)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('createClient', () => {
  it('is simulated without VITE_CHAT_URL', () => {
    vi.stubEnv('VITE_CHAT_URL', '')
    expect(isLiveSimulated()).toBe(true)
  })
  it('throws for live when a backend URL is set', () => {
    vi.stubEnv('VITE_CHAT_URL', 'https://example.test')
    expect(isLiveSimulated()).toBe(false)
    expect(() => createClient('live')).toThrow('HttpChatClient not implemented yet')
    expect(() => createClient('offline')).not.toThrow()
  })
})
