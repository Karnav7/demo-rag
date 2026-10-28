import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { NodeLabel, Subgraph } from '../../domain/types'
import { confToken, matchScore, riskToken } from '../theme/scale'

export type GraphNode = Subgraph['nodes'][number]
export type GraphEdge = Subgraph['edges'][number]

/** Canonical label order (legend, radial grouping). */
export const LABEL_ORDER: NodeLabel[] = [
  'Person', 'Company', 'Account', 'Transaction', 'Address', 'Device',
  'SanctionsEntry', 'Jurisdiction', 'Regulation', 'Case', 'Alert', 'Document', 'Section',
]

const DISPLAY: Partial<Record<NodeLabel, string>> = { SanctionsEntry: 'Sanctions entry' }
export const labelName = (l: NodeLabel) => DISPLAY[l] ?? l

/** Light-theme values, used when the CSS token cannot be read (jsdom, detached documents). */
const FALLBACK: Record<NodeLabel, string> = {
  Person: '#5f7a99', Company: '#8a7550', Account: '#5e8a6e', Transaction: '#8f7aa8',
  Address: '#9a8f7d', Device: '#5f8b8f', SanctionsEntry: '#a8453b', Jurisdiction: '#7d6b5a',
  Regulation: '#6b6f8a', Case: '#a8687a', Alert: '#c08a2e', Document: '#7a7466', Section: '#9c9586',
}

/** Every NodeLabel (the Record type above forces completeness). */
export const NODE_LABELS = Object.keys(FALLBACK) as NodeLabel[]

/** The CSS reference for SVG fills: follows the theme cross-fade without a re-render. */
export const cssColor = (label: NodeLabel) => `var(--node-${label}, ${FALLBACK[label]})`

/** The resolved colour for the current theme (for canvas/WebGL views, which cannot use var()). */
export function colorFor(label: NodeLabel): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--node-${label}`).trim()
    if (v) return v
  } catch {
    // no DOM; use the fallback
  }
  return FALLBACK[label] ?? '#8a8478'
}

/** The active theme ('light' | 'dark'), re-rendering when `data-theme` changes. */
export function useDocumentTheme(): string {
  const read = () => document.documentElement.dataset.theme ?? 'light'
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return theme
}

/**
 * The passage to open for a node: from its first used edge, else any edge, whose section the answer lists as a
 * source (`cited`). Null when none of its edges is backed by a listed source.
 */
export function firstCitedSection(g: Subgraph, nodeId: string, cited: ReadonlySet<string>): string | null {
  const touching = g.edges.filter((e) => (e.from === nodeId || e.to === nodeId) && e.section_id && cited.has(e.section_id))
  return (touching.find((e) => e.used) ?? touching[0])?.section_id ?? null
}

/** Data colour for an edge: sanctions matches by match strength, edges used in the answer by confidence. */
export function edgeTint(e: GraphEdge): CSSProperties | undefined {
  if (e.type === 'MATCHES') return { stroke: riskToken(matchScore(e)) }
  if (e.used) return { stroke: confToken(e.confidence) }
  return undefined
}

/** Opacity for an element under the "dim unused" toggle. */
export const DIM = 0.15
export const dimmed = (dim: boolean, used: boolean) => (dim && !used ? DIM : undefined)

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The accessible summary every graph view carries. */
export const summary = (g: Subgraph) =>
  `Subgraph: ${count(g.nodes.length, 'entity', 'entities')}, ${count(g.edges.length, 'relationship', 'relationships')}, ${g.edges.filter((e) => e.used).length} used in the answer`

export const nodeAria =(n: GraphNode) => `${n.name} (${labelName(n.label)})`

/** Keyboard + click activation for an SVG node. */
export function activate(open: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      }
    },
  }
}

/** The props every graph view receives (Force, Radial, Replay here; Orbit and 3D in Task 12). */
export interface GraphViewProps {
  subgraph: Subgraph
  /** Drop unused nodes and edges to 15% opacity. */
  dim: boolean
  onNodeOpen(nodeId: string): void
}

/** Shown in place of the 3D view when WebGL is missing, the renderer cannot start, or its chunk fails to load. */
export const WEBGL_FALLBACK = "3D view needs WebGL, which isn't available here."
