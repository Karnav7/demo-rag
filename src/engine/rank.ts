import type { Fact, GRel } from '../domain/types'
import type { WorldIndex } from '../data/load'

/** Facts sorted by confidence / (1 + dist of nearer endpoint); ties by rel id. */
export function rankFacts(w: WorldIndex, rels: GRel[], dist: Map<string, number>): Fact[] {
  const scored = rels
    .filter((r) => r.type !== 'HAS_SECTION')
    .map((r) => {
      const d = Math.min(dist.get(r.from) ?? Infinity, dist.get(r.to) ?? Infinity)
      const dd = Number.isFinite(d) ? d : 99
      return { r, score: r.confidence / (1 + dd) }
    })
  scored.sort((a, b) => b.score - a.score || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0))
  return scored.map(({ r }) => ({
    rel_id: r.id,
    subject: w.byId.get(r.from)?.name ?? r.from,
    relation: r.type,
    object: w.byId.get(r.to)?.name ?? r.to,
    confidence: r.confidence,
    section_id: r.section_id,
    used: false,
  }))
}
