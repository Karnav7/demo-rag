import type { GRel, RelType } from '../domain/types'
import type { WorldIndex } from '../data/load'

export interface ExpandOpts { hops: number; types: RelType[]; jurisdictions: string[] | null }
export interface Expansion { nodeIds: Set<string>; rels: GRel[]; dist: Map<string, number> }

const BLOCKED = new Set(['Document', 'Section'])

/** Undirected BFS from seeds; rels keep their stored direction. */
export function expand(w: WorldIndex, seeds: string[], opts: ExpandOpts): Expansion {
  const types = new Set<RelType>(opts.types)
  const juris = opts.jurisdictions ? new Set(opts.jurisdictions) : null
  const seedSet = new Set(seeds)
  const dist = new Map<string, number>()
  const nodeIds = new Set<string>()
  const relMap = new Map<string, GRel>()

  const allowed = (id: string): boolean => {
    const n = w.byId.get(id)
    if (!n || BLOCKED.has(n.label)) return false
    if (seedSet.has(id)) return true
    return !(juris && n.jurisdiction && !juris.has(n.jurisdiction))
  }

  let frontier: string[] = []
  for (const s of [...seeds].sort()) {
    if (!w.byId.has(s) || dist.has(s)) continue
    dist.set(s, 0)
    nodeIds.add(s)
    frontier.push(s)
  }
  for (let d = 0; d < opts.hops && frontier.length; d++) {
    const next: string[] = []
    for (const id of frontier) {
      const incident = [...(w.out.get(id) ?? []), ...(w.in.get(id) ?? [])]
      incident.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      for (const r of incident) {
        if (!types.has(r.type) || r.type === 'HAS_SECTION') continue
        const other = r.from === id ? r.to : r.from
        if (!allowed(other)) continue
        relMap.set(r.id, r)
        if (!dist.has(other)) {
          dist.set(other, d + 1)
          nodeIds.add(other)
          next.push(other)
        }
      }
    }
    frontier = next
  }
  const rels = [...relMap.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { nodeIds, rels, dist }
}

const CODES: Record<string, RegExp> = {
  UK: /\b(UK|GB)\b/, US: /\b(US|USA)\b/, EU: /\bEU\b/, VG: /\b(BVI|VG)\b/,
}
const WORDS: Record<string, RegExp> = {
  UK: /\b(united kingdom|british|britain|england)\b/i,
  US: /\b(united states|american|america)\b/i,
  EU: /\b(european|europe)\b/i,
  VG: /\b(british virgin islands|offshore)\b/i,
}

/** Jurisdiction codes named in the question, or null. 2-letter codes are case-sensitive (so "us" the pronoun is ignored). */
export function jurisdictionsIn(_w: WorldIndex, q: string): string[] | null {
  // "British Virgin Islands" must not also count as British/UK.
  const rest = q.replace(/british virgin islands/gi, ' ')
  const found = Object.keys(CODES).filter((c) => CODES[c].test(q) || WORDS[c].test(c === 'VG' ? q : rest))
  return found.length ? found : null
}
