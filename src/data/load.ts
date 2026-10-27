import raw from './world.json'
import type { GNode, GRel, Section, World } from '../domain/types'

export type WorldIndex = World & {
  byId: Map<string, GNode>
  out: Map<string, GRel[]>
  in: Map<string, GRel[]>
  sectionById: Map<string, Section>
}

let cached: WorldIndex | null = null

function push(map: Map<string, GRel[]>, key: string, rel: GRel) {
  const list = map.get(key)
  if (list) list.push(rel)
  else map.set(key, [rel])
}

/** The fictional world with adjacency indexes, built once and memoised. */
export function loadWorld(): WorldIndex {
  if (cached) return cached
  // JSON literal types (label: string, sparse props) are wider than the contract; world.test.ts checks the shape.
  const world = raw as unknown as World
  const byId = new Map(world.nodes.map((n) => [n.id, n]))
  const out = new Map<string, GRel[]>()
  const inn = new Map<string, GRel[]>()
  for (const r of world.rels) {
    push(out, r.from, r)
    push(inn, r.to, r)
  }
  const sectionById = new Map(world.sections.map((s) => [s.id, s]))
  cached = { ...world, byId, out, in: inn, sectionById }
  return cached
}
