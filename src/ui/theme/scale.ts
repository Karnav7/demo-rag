import type { Subgraph } from '../../domain/types'

/**
 * Data-driven colour: values map to theme tokens (tokens.css), so every ramp follows the theme cross-fade.
 * Confidence: --conf-1 (weak, amber) … --conf-5 (strong, periwinkle/indigo).
 * Risk: --risk-1 (cleared) … --risk-3 (strong sanctions match, alert).
 * Timing: a cool → warm mix by share of the slowest stage.
 */

const CONF_EDGES = [0.5, 0.65, 0.8, 0.9]
const RISK_EDGES = [0.5, 0.8]

const level = (v: number, edges: number[]) => (Number.isFinite(v) ? 1 + edges.filter((e) => v >= e).length : 1)

export const confLevel = (v: number) => level(v, CONF_EDGES)
export const confToken = (v: number) => `var(--conf-${confLevel(v)})`

export const riskLevel = (score: number) => level(score, RISK_EDGES)
export const riskToken = (score: number) => `var(--risk-${riskLevel(score)})`

export function heatMix(ms: number, maxMs: number): string {
  const pct = maxMs > 0 ? Math.round(Math.max(0, Math.min(1, ms / maxMs)) * 100) : 100
  return `color-mix(in oklab, var(--heat-warm) ${pct}%, var(--heat-cool))`
}

type Node = Subgraph['nodes'][number]
type Edge = Subgraph['edges'][number]

/** A MATCHES edge's match strength (props.score), distinct from its extraction confidence. */
export const matchScore = (e: Edge) => (typeof e.props.score === 'number' ? e.props.score : 0)

/** 0 = not a risk entity; 1–3 for sanctions entries (by strongest match) and alerts (always 3). */
export function nodeRisk(g: Subgraph, n: Node): 0 | 1 | 2 | 3 {
  if (n.label === 'Alert') return 3
  if (n.label !== 'SanctionsEntry') return 0
  const best = Math.max(0, ...g.edges.filter((e) => e.type === 'MATCHES' && (e.to === n.id || e.from === n.id)).map(matchScore))
  return riskLevel(best) as 1 | 2 | 3
}
