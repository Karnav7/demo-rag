import type { WorldIndex } from '../data/load'
import type { Hit } from './fuse'
import { entityText, isEntity, tokenize } from './lexical'

const DIM = 256

/** Small synonym groups: a token in a group also activates the group's other members. */
const SYNONYMS: string[][] = [
  ['owner', 'owners', 'owns', 'owned', 'ownership', 'ubo', 'beneficial', 'shareholder'],
  ['flagged', 'flag', 'flags', 'alert', 'alerts', 'alerted'],
  ['sanctioned', 'sanctions', 'sanction', 'listed', 'watchlist'],
  ['director', 'directors', 'officer', 'board'],
  ['controls', 'control', 'controlled', 'controller'],
  ['transaction', 'transactions', 'transfer', 'wire', 'payment'],
  ['address', 'addresses', 'registered', 'location'],
  ['company', 'companies', 'firm', 'entity', 'business'],
  ['person', 'people', 'individual'],
]
const SYN = new Map<string, string[]>()
for (const g of SYNONYMS) for (const t of g) SYN.set(t, g)

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function embed(tokens: string[]): Float64Array {
  const v = new Float64Array(DIM)
  for (const tok of tokens) {
    const padded = `^${tok}$`
    for (let i = 0; i + 3 <= padded.length; i++) v[hash(padded.slice(i, i + 3)) % DIM] += 1
  }
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < DIM; i++) v[i] /= norm
  return v
}

const cache = new WeakMap<WorldIndex, { id: string; v: Float64Array }[]>()

/** Deterministic stand-in for dense retrieval: hashed character trigrams + synonyms, cosine ranked. */
export function vectorSearch(w: WorldIndex, q: string, k = 12): Hit[] {
  let docs = cache.get(w)
  if (!docs) {
    docs = w.nodes.filter(isEntity).map((n) => ({ id: n.id, v: embed([...tokenize(entityText(n)), n.label.toLowerCase()]) }))
    cache.set(w, docs)
  }
  const toks = tokenize(q)
  const expanded = toks.flatMap((t) => SYN.get(t) ?? [t])
  const qv = embed([...new Set(expanded)])
  const hits: Hit[] = []
  for (const d of docs) {
    let dot = 0
    for (let i = 0; i < DIM; i++) dot += qv[i] * d.v[i]
    if (dot > 0) hits.push({ id: d.id, score: dot })
  }
  return hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, k)
}
