import { describe, expect, it } from 'vitest'
import { loadWorld } from '../data/load'
import { MERIDIAN } from '../data/scenarios'
import { lexicalSearch } from './lexical'
import { vectorSearch } from './vector'
import { rrf } from './fuse'

const w = loadWorld()

describe('retrieval', () => {
  it('lexical matches aliases case-insensitively', () => {
    const alias = w.byId.get(MERIDIAN)!.aliases![0]
    expect(lexicalSearch(w, alias.toUpperCase())[0].id).toBe(MERIDIAN)
  })

  it('lexical ignores stopwords', () => {
    expect(lexicalSearch(w, 'who is the')).toEqual([])
  })

  it('lexical excludes Document and Section nodes', () => {
    const labels = lexicalSearch(w, 'Meridian registry kyc case', 50).map((h) => w.byId.get(h.id)!.label)
    expect(labels).not.toContain('Document')
    expect(labels).not.toContain('Section')
  })

  it('vector tolerates paraphrase', () => {
    const ids = vectorSearch(w, 'beneficial owner of meridian').slice(0, 3).map((h) => h.id)
    expect(ids).toContain(MERIDIAN)
  })

  it('respects k and sorts by descending score', () => {
    const hits = vectorSearch(w, 'meridian', 5)
    expect(hits).toHaveLength(5)
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score)
  })

  it('rrf fuses ranked lists', () => {
    const a = { id: 'a', score: 1 }, b = { id: 'b', score: 1 }, c = { id: 'c', score: 1 }
    const out = rrf([[a, b], [b, c]])
    expect(out[0].id).toBe('b')
    expect(Math.abs(out[0].score - (1 / 61 + 1 / 62))).toBeLessThan(1e-9)
    expect(out.map((h) => h.id)).toEqual(['b', 'a', 'c'])
  })

  it('is deterministic', () => {
    const q = 'who owns meridian trade'
    expect(lexicalSearch(w, q)).toEqual(lexicalSearch(w, q))
    expect(vectorSearch(w, q)).toEqual(vectorSearch(w, q))
  })
})
