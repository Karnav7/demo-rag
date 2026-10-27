import { describe, expect, it } from 'vitest'
import { loadWorld } from '../data/load'
import { MERIDIAN, UBO } from '../data/scenarios'
import { expand, jurisdictionsIn } from './expand'
import { rankFacts } from './rank'
import type { GRel, RelType } from '../domain/types'

const w = loadWorld()
const ALL: RelType[] = ['OWNS', 'DIRECTOR_OF', 'CONTROLS', 'HOLDS', 'SENT', 'RECEIVED', 'REGISTERED_AT', 'USED_DEVICE', 'MATCHES', 'INCORPORATED_IN', 'GOVERNED_BY', 'SUBJECT_OF', 'FLAGS']

describe('expand', () => {
  it('3 hops from Meridian reaches the UBO', () => {
    const r = expand(w, [MERIDIAN], { hops: 3, types: ALL, jurisdictions: null })
    expect(r.nodeIds.has(UBO)).toBe(true)
  })

  it('hops bound respected', () => {
    const r = expand(w, [MERIDIAN], { hops: 1, types: ALL, jurisdictions: null })
    expect(r.nodeIds.size).toBeGreaterThan(1)
    expect(Math.max(...r.dist.values())).toBeLessThanOrEqual(1)
    expect(r.dist.get(MERIDIAN)).toBe(0)
  })

  it('types filter', () => {
    const r = expand(w, [MERIDIAN], { hops: 4, types: ['OWNS'], jurisdictions: null })
    expect(r.rels.length).toBeGreaterThan(0)
    expect(r.rels.every((x) => x.type === 'OWNS')).toBe(true)
  })

  it('jurisdiction scope excludes US nodes when UK is named', () => {
    const j = jurisdictionsIn(w, 'Which UK companies are linked?')
    expect(j).toEqual(['UK'])
    const r = expand(w, [MERIDIAN], { hops: 4, types: ALL, jurisdictions: j })
    for (const id of r.nodeIds) {
      const jur = w.byId.get(id)!.jurisdiction
      if (jur && id !== MERIDIAN) expect(jur).toBe('UK')
    }
  })

  it('no Document/Section nodes in expansion', () => {
    const r = expand(w, [MERIDIAN], { hops: 4, types: [...ALL, 'HAS_SECTION'], jurisdictions: null })
    for (const id of r.nodeIds) expect(['Document', 'Section']).not.toContain(w.byId.get(id)?.label)
    expect(r.rels.some((x) => x.type === 'HAS_SECTION')).toBe(false)
  })

  it('is deterministic', () => {
    const a = expand(w, [MERIDIAN], { hops: 3, types: ALL, jurisdictions: null })
    const b = expand(w, [MERIDIAN], { hops: 3, types: ALL, jurisdictions: null })
    expect(a.rels.map((x) => x.id)).toEqual(b.rels.map((x) => x.id))
  })
})

describe('jurisdictionsIn', () => {
  it('recognises names and ignores the pronoun us', () => {
    expect(jurisdictionsIn(w, 'tell us about Meridian')).toBeNull()
    expect(jurisdictionsIn(w, 'US and British entities')?.sort()).toEqual(['UK', 'US'])
    expect(jurisdictionsIn(w, 'offshore BVI shells')).toEqual(['VG'])
    expect(jurisdictionsIn(w, 'European banks')).toEqual(['EU'])
  })
})

describe('rankFacts', () => {
  it('rank order: nearer fact first at equal confidence', () => {
    const [a, b] = w.rels.filter((r) => r.type !== 'HAS_SECTION').slice(0, 2)
    const mk = (r: GRel, id: string): GRel => ({ ...r, id, confidence: 0.9 })
    const near = mk(a, 'near'), far = mk(b, 'far')
    const dist = new Map<string, number>([[near.from, 0], [near.to, 1], [far.from, 2], [far.to, 2]])
    const facts = rankFacts(w, [far, near], dist)
    expect(facts.map((f) => f.rel_id)).toEqual(['near', 'far'])
    expect(facts[0].used).toBe(false)
    expect(facts[0].subject).toBe(w.byId.get(near.from)!.name)
  })
})
