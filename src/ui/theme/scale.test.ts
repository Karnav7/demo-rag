import { describe, expect, it } from 'vitest'
import { confLevel, confToken, heatMix, nodeRisk, riskLevel, riskToken } from './scale'
import type { Subgraph } from '../../domain/types'

describe('confidence scale', () => {
  it.each([
    [0, 1], [0.49, 1], [0.5, 2], [0.64, 2], [0.65, 3], [0.79, 3], [0.8, 4], [0.89, 4], [0.9, 5], [1, 5],
  ])('%s → level %s', (v, level) => {
    expect(confLevel(v)).toBe(level)
  })
  it('clamps out-of-range and non-finite values', () => {
    expect(confLevel(-1)).toBe(1)
    expect(confLevel(7)).toBe(5)
    expect(confLevel(Number.NaN)).toBe(1)
  })
  it('names the theme token', () => {
    expect(confToken(0.95)).toBe('var(--conf-5)')
    expect(confToken(0.55)).toBe('var(--conf-2)')
  })
})

describe('risk scale', () => {
  it.each([[0, 1], [0.49, 1], [0.5, 2], [0.79, 2], [0.8, 3], [1, 3]])('%s → level %s', (s, level) => {
    expect(riskLevel(s)).toBe(level)
  })
  it('names the theme token', () => {
    expect(riskToken(0.9)).toBe('var(--risk-3)')
  })
})

describe('timing heat', () => {
  it('mixes cool → warm by share of the slowest stage', () => {
    expect(heatMix(0, 200)).toBe('color-mix(in oklab, var(--heat-warm) 0%, var(--heat-cool))')
    expect(heatMix(100, 200)).toBe('color-mix(in oklab, var(--heat-warm) 50%, var(--heat-cool))')
    expect(heatMix(200, 200)).toBe('color-mix(in oklab, var(--heat-warm) 100%, var(--heat-cool))')
    expect(heatMix(5, 0)).toBe('color-mix(in oklab, var(--heat-warm) 100%, var(--heat-cool))')
  })
})

describe('node risk', () => {
  const node = (id: string, label: Subgraph['nodes'][number]['label']) =>
    ({ id, label, name: id, props: {}, used: false, seed: false }) as Subgraph['nodes'][number]
  const edge = (id: string, from: string, to: string, type: Subgraph['edges'][number]['type'], score?: number) =>
    ({ id, type, from, to, confidence: 0.9, section_id: null, props: score === undefined ? {} : { score }, used: false }) as Subgraph['edges'][number]
  const g: Subgraph = {
    nodes: [node('p', 'Person'), node('s', 'SanctionsEntry'), node('q', 'Person'), node('cleared', 'SanctionsEntry'), node('a', 'Alert')],
    edges: [edge('m1', 'p', 's', 'MATCHES', 0.91), edge('m2', 'q', 'cleared', 'MATCHES', 0.41), edge('f', 'a', 'p', 'FLAGS')],
  }
  it('rates sanctions entries by their strongest match and alerts as high', () => {
    expect(nodeRisk(g, g.nodes[1])).toBe(3)
    expect(nodeRisk(g, g.nodes[3])).toBe(1)
    expect(nodeRisk(g, g.nodes[4])).toBe(3)
  })
  it('leaves other entities unrated', () => {
    expect(nodeRisk(g, g.nodes[0])).toBe(0)
  })
})
