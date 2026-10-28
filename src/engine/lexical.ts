import type { GNode } from '../domain/types'
import type { WorldIndex } from '../data/load'
import type { Hit } from './fuse'

const STOPWORDS = new Set(
  'a an and are as at be by did do does for from has have how i in is it its me of on or show tell that the their there these this to was what when where which who whom why with about'.split(' '),
)

/** Quantifier and listing words: they say how to answer, not what about, so they never match an entity on their own ("list all persons"). */
const GENERIC = new Set('all any every each list'.split(' '))

/** The question's tokens that can identify an entity. */
export function queryTerms(q: string): string[] {
  return [...new Set(tokenize(q).filter((t) => !GENERIC.has(t)))]
}

/** Tokens of an entity's name and aliases. */
export function entityTerms(n: GNode): Set<string> {
  return new Set(tokenize(entityText(n)))
}

/** Provenance nodes are not entities; neither index returns them. */
export function isEntity(n: GNode): boolean {
  return n.label !== 'Document' && n.label !== 'Section'
}

export function entityText(n: GNode): string {
  return [n.name, ...(n.aliases ?? [])].join(' ')
}

/** Lowercase alphanumeric tokens, stopwords removed. Spaced ids (IBANs) also add their compact form. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const out = words.filter((t) => !STOPWORDS.has(t))
  for (let i = 0; i + 1 < words.length; i++) {
    const pair = words[i] + words[i + 1]
    if (/\d/.test(words[i]) && /\d/.test(words[i + 1]) && words[i].length <= 4) out.push(pair)
  }
  return out
}

const K1 = 1.4
const B = 0.75

interface Index {
  tf: Map<string, number>[]
  len: number[]
  df: Map<string, number>
  avg: number
  nodes: GNode[]
}
const cache = new WeakMap<WorldIndex, Index>()

function build(w: WorldIndex): Index {
  const nodes = w.nodes.filter(isEntity)
  const tf: Map<string, number>[] = []
  const len: number[] = []
  const df = new Map<string, number>()
  for (const n of nodes) {
    const toks = tokenize(entityText(n))
    const m = new Map<string, number>()
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1)
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1)
    tf.push(m)
    len.push(toks.length)
  }
  return { tf, len, df, avg: len.reduce((a, b) => a + b, 0) / (len.length || 1), nodes }
}

/** BM25 over tokenised name + aliases of entity nodes. */
export function lexicalSearch(w: WorldIndex, q: string, k = 12): Hit[] {
  let idx = cache.get(w)
  if (!idx) cache.set(w, (idx = build(w)))
  const terms = queryTerms(q)
  const N = idx.nodes.length
  const hits: Hit[] = []
  idx.nodes.forEach((n, i) => {
    let score = 0
    for (const t of terms) {
      const f = idx!.tf[i].get(t)
      if (!f) continue
      const d = idx!.df.get(t)!
      const idf = Math.log(1 + (N - d + 0.5) / (d + 0.5))
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * idx!.len[i]) / idx!.avg))
    }
    if (score > 0) hits.push({ id: n.id, score })
  })
  return hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, k)
}
