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

const SYNONYM_WEIGHT = 0.3
const LABEL_WEIGHT = 0.3
const NUMERIC_BOOST = 2

/** Weighted token bag -> normalised trigram vector. Long digit-bearing tokens (years, amounts, ids) are boosted; short ones (day numbers) are not. */
function embed(tokens: Map<string, number>): Float64Array {
  const v = new Float64Array(DIM)
  for (const [tok, weight] of tokens) {
    const w = /\d/.test(tok) && tok.length >= 4 ? weight * NUMERIC_BOOST : weight
    const padded = `^${tok}$`
    for (let i = 0; i + 3 <= padded.length; i++) {
      const h = hash(padded.slice(i, i + 3))
      // Signed feature hashing: colliding trigrams cancel in expectation instead of inflating similarity.
      v[h % DIM] += (h & 0x100) === 0 ? w : -w
    }
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
    docs = w.nodes.filter(isEntity).map((n) => {
      const bag = new Map<string, number>()
      for (const t of tokenize(entityText(n))) bag.set(t, 1)
      const label = n.label.toLowerCase()
      if (!bag.has(label)) bag.set(label, LABEL_WEIGHT)
      return { id: n.id, v: embed(bag) }
    })
    cache.set(w, docs)
  }
  const bag = new Map<string, number>()
  for (const t of tokenize(q)) bag.set(t, 1)
  for (const t of [...bag.keys()]) for (const s of SYN.get(t) ?? []) if (!bag.has(s)) bag.set(s, SYNONYM_WEIGHT)
  const qv = embed(bag)
  const hits: Hit[] = []
  for (const d of docs) {
    let dot = 0
    for (let i = 0; i < DIM; i++) dot += qv[i] * d.v[i]
    if (dot > 0) hits.push({ id: d.id, score: dot })
  }
  return hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, k)
}
