import { loadWorld } from '../data/load'
import type { ChatEvent, ChatRequest } from '../domain/types'
import { runPipeline } from '../engine/pipeline'
import type { ChatClient } from './chatClient'

export interface LatencyProfile { minMs: number; maxMs: number }
export const LATENCY: Record<'offline' | 'live', LatencyProfile> = {
  offline: { minMs: 40, maxMs: 120 },
  live: { minMs: 120, maxMs: 450 },
}
const TOKEN_MS = { min: 18, max: 35 }

/** Seeded PRNG (mulberry32) keyed by a string, so timings are stable per question. */
function seeded(key: string): () => number {
  let h = 1779033703 ^ key.length
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19))
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Resolves after ms, or early (returning false) when the signal aborts. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = () => { clearTimeout(timer); resolve(false) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true) }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Splits into 1-3 word chunks; the pieces concatenate back to the exact input. */
function chunk(answer: string, rand: () => number): string[] {
  const words = answer.match(/\s*\S+|\s+$/g) ?? []
  const out: string[] = []
  for (let i = 0; i < words.length; ) {
    const n = 1 + Math.floor(rand() * 3)
    out.push(words.slice(i, i + n).join(''))
    i += n
  }
  return out
}

export class SnapshotChatClient implements ChatClient {
  constructor(private readonly latency: LatencyProfile) {}

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const rand = seeded(req.question)
    const between = (min: number, max: number) => Math.round(min + rand() * (max - min))
    const { stages: raw, response } = runPipeline(loadWorld(), req)

    const stages = raw.map((s) => ({ ...s, ms: between(this.latency.minMs, this.latency.maxMs) }))
    for (const stage of stages) {
      if (!(await wait(stage.ms, signal))) return
      yield { type: 'stage', stage }
    }
    for (const text of chunk(response.answer, rand)) {
      if (!(await wait(between(TOKEN_MS.min, TOKEN_MS.max), signal))) return
      yield { type: 'token', text }
    }
    if (signal.aborted) return
    const totalMs = stages.reduce((sum, s) => sum + s.ms, 0)
    yield { type: 'done', response: { ...response, trace: stages, stats: { ...response.stats, totalMs } } }
  }
}
