import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import type { Subgraph, TraceStage } from '../../domain/types'
import { useReducedMotion } from '../theme/motion'
import { Edges, H, NodeMark, W, forceLayout, useZoom } from './Force'
import { dimmed, edgeTint, summary, type GraphViewProps } from './graphStyle'
import { nodeRisk } from '../theme/scale'

export const STEP_MS = 700
const LEAD_MS = 300

export interface ReplayStep {
  title: string
  nodes: string[]
  edges: string[]
}

/** Hop distance from the nearest seed (undirected). Unreachable nodes are absent. */
function hops(g: Subgraph): Map<string, number> {
  const dist = new Map(g.nodes.filter((n) => n.seed).map((n) => [n.id, 0]))
  let frontier = [...dist.keys()]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const e of g.edges) {
        const other = e.from === id ? e.to : e.to === id ? e.from : null
        if (other && !dist.has(other)) {
          dist.set(other, dist.get(id)! + 1)
          next.push(other)
        }
      }
    }
    frontier = next
  }
  return dist
}

/** The retrieval as it happened: hits, then seeds, then the expansion ring by distance, then the facts used. */
export function replaySteps(g: Subgraph, trace: TraceStage[]): ReplayStep[] {
  const steps: ReplayStep[] = []
  const has = (id: TraceStage['id']) => trace.some((s) => s.id === id)
  const lex = has('lexical')
  const vec = has('vector')
  if (lex || vec) {
    const text = trace.filter((s) => s.id === 'lexical' || s.id === 'vector' || s.id === 'fuse').map((s) => s.detail).join('\n')
    const hits = g.nodes.filter((n) => n.seed || text.includes(n.name)).map((n) => n.id)
    steps.push({ title: lex && vec ? 'Lexical and vector hits' : lex ? 'Lexical hits' : 'Vector hits', nodes: hits, edges: [] })
  }
  const seeds = g.nodes.filter((n) => n.seed).map((n) => n.id)
  if (seeds.length) steps.push({ title: 'Seeds', nodes: seeds, edges: [] })

  const dist = hops(g)
  const far = Math.max(0, ...dist.values())
  for (let d = 1; d <= far; d++) {
    steps.push({
      title: `Expansion · ${d} ${d === 1 ? 'hop' : 'hops'}`,
      nodes: g.nodes.filter((n) => dist.get(n.id) === d).map((n) => n.id),
      edges: g.edges.filter((e) => Math.max(dist.get(e.from) ?? 0, dist.get(e.to) ?? 0) === d && dist.has(e.from) && dist.has(e.to)).map((e) => e.id),
    })
  }
  const stray = { nodes: g.nodes.filter((n) => !dist.has(n.id)).map((n) => n.id), edges: g.edges.filter((e) => !dist.has(e.from) || !dist.has(e.to)).map((e) => e.id) }
  if (stray.nodes.length || stray.edges.length) steps.push({ title: 'Expansion · rest of the subgraph', ...stray })

  steps.push({
    title: 'Used facts',
    nodes: g.nodes.filter((n) => n.used).map((n) => n.id),
    edges: g.edges.filter((e) => e.used).map((e) => e.id),
  })
  return steps
}

export function Replay({ subgraph, trace, dim, onNodeOpen }: GraphViewProps & { trace: TraceStage[] }) {
  const reduced = useReducedMotion()
  const pos = useMemo(() => forceLayout(subgraph), [subgraph])
  const steps = useMemo(() => replaySteps(subgraph, trace), [subgraph, trace])
  const last = steps.length - 1
  const [i, setI] = useState(reduced ? last : -1)
  const [playing, setPlaying] = useState(!reduced)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomT = useZoom(svgRef)

  const running = playing && i < last && !reduced
  useEffect(() => {
    if (!running) return
    const t = setTimeout(() => setI((x) => x + 1), i < 0 ? LEAD_MS : STEP_MS)
    return () => clearTimeout(t)
  }, [running, i])

  // Reduced motion: no autoplay; land on the final state.
  useEffect(() => {
    if (reduced) setI(last)
  }, [reduced, last])

  const lit = useMemo(() => {
    const nodes = new Set<string>()
    const edges = new Set<string>()
    steps.slice(0, i + 1).forEach((s) => {
      s.nodes.forEach((id) => nodes.add(id))
      s.edges.forEach((id) => edges.add(id))
    })
    return { nodes, edges }
  }, [steps, i])
  const fresh = i >= 0 ? steps[i] : null
  const final = i === last
  const seedsShown = steps.findIndex((s) => s.title === 'Seeds') <= i && i >= 0

  const restart = () => {
    setI(reduced ? 0 : -1)
    setPlaying(!reduced)
  }
  const toggle = () => {
    if (i >= last) {
      setI(-1)
      setPlaying(true)
    } else setPlaying((p) => !p)
  }

  return (
    <div className="g-replay">
      <svg ref={svgRef} className="g-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={summary(subgraph)}>
        <g transform={zoomT}>
          <Edges
            g={subgraph}
            pos={pos}
            edgeClass={(e) =>
              [lit.edges.has(e.id) && 'is-lit', fresh?.edges.includes(e.id) && 'is-fresh', final && e.used && 'is-used'].filter(Boolean).join(' ')
            }
            edgeStyle={(e) => ({ opacity: dimmed(dim, e.used), ...(final ? edgeTint(e) : undefined) })}
          />
          <g className="g-nodes">
            {subgraph.nodes.map((n, idx) => {
              const p = pos.get(n.id)!
              const isLit = lit.nodes.has(n.id)
              const isFresh = !!fresh?.nodes.includes(n.id)
              return (
                <NodeMark
                  key={n.id}
                  n={n}
                  x={p.x}
                  y={p.y}
                  i={idx}
                  onOpen={() => onNodeOpen(n.id)}
                  className={`${isLit ? 'is-lit' : ''}${isFresh ? ' is-fresh' : ''}`}
                  ring={(final && n.used) || isFresh}
                  filled={n.seed && seedsShown}
                  label={isLit && (n.seed || n.used)}
                  risk={final ? nodeRisk(subgraph, n) : 0}
                  style={{ opacity: dimmed(dim, n.used) }}
                />
              )
            })}
          </g>
        </g>
      </svg>
      <div className="g-replay__bar">
        {reduced ? (
          <>
            <button type="button" className="g-btn" aria-label="Previous step" disabled={i <= 0} onClick={() => setI((x) => Math.max(0, x - 1))}>
              <SkipBack size={14} aria-hidden />
            </button>
            <button type="button" className="g-btn" aria-label="Next step" disabled={i >= last} onClick={() => setI((x) => Math.min(last, x + 1))}>
              <SkipForward size={14} aria-hidden />
            </button>
          </>
        ) : (
          <button type="button" className="g-btn" aria-label={running ? 'Pause' : 'Play'} onClick={toggle}>
            {running ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          </button>
        )}
        <button type="button" className="g-btn" aria-label="Restart" onClick={restart}>
          <RotateCcw size={14} aria-hidden />
        </button>
        <p className="g-replay__step" aria-live="polite">
          {fresh ? (
            <>
              <span className="g-replay__count">
                {i + 1}/{steps.length}
              </span>
              {fresh.title}
            </>
          ) : (
            'Retrieval replay'
          )}
        </p>
        <div className="g-replay__track" aria-hidden>
          {steps.map((s, k) => (
            <span key={s.title} className={k <= i ? 'is-on' : ''} />
          ))}
        </div>
      </div>
    </div>
  )
}
