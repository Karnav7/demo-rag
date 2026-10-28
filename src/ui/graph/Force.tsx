import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  type Force as D3Force,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { select } from 'd3-selection'
import { zoom } from 'd3-zoom'
import type { Subgraph } from '../../domain/types'
import { activate, cssColor, dimmed, nodeAria, summary, type GraphNode, type GraphViewProps } from './graphStyle'

/** The drawing box every 2D view lays out in (viewBox units). */
export const W = 360
export const H = 280
const PAD = 28
const STAGGER = 30 // ms between successive nodes / edges
const MAX_STAGGER = 24

export type Pos = Map<string, { x: number; y: number }>
interface SimNode extends SimulationNodeDatum { id: string }
type SimLink = SimulationLinkDatum<SimNode> & { len?: number }

const linksOf = (g: Subgraph): SimLink[] => {
  const ids = new Set(g.nodes.map((n) => n.id))
  return g.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ source: e.from, target: e.to }))
}

/**
 * A minimal, timer-free force stepper over d3-force's forces. d3's own `forceSimulation` starts a
 * d3-timer on construction (rAF captured at import + a poke `setInterval`), which never drains under
 * fake timers; stepping by hand keeps layout synchronous and lets the live view own its rAF loop.
 */
export interface Stepper {
  nodes: SimNode[]
  /** Advance one tick toward `alphaTarget`; returns false once settled. */
  tick(alphaTarget?: number): boolean
  reheat(alpha: number): void
}
export function stepper(nodes: SimNode[], forces: D3Force<SimNode, SimLink>[], alpha = 1): Stepper {
  let seed = 1
  const random = () => ((seed = (1664525 * seed + 1013904223) % 4294967296) / 4294967296)
  nodes.forEach((n, i) => {
    n.index = i
    if (n.x == null || n.y == null) {
      const r = 10 * Math.sqrt(0.5 + i)
      const a = i * Math.PI * (3 - Math.sqrt(5))
      n.x = W / 2 + r * Math.cos(a)
      n.y = H / 2 + r * Math.sin(a)
    }
    n.vx = n.vy = 0
  })
  forces.forEach((f) => f.initialize?.(nodes, random))
  const decay = 1 - Math.pow(0.001, 1 / 300)
  return {
    nodes,
    reheat: (a) => {
      alpha = Math.max(alpha, a)
    },
    tick: (target = 0) => {
      alpha += (target - alpha) * decay
      forces.forEach((f) => f(alpha))
      for (const n of nodes) {
        if (n.fx != null) (n.x = n.fx), (n.vx = 0)
        else n.x! += n.vx! *= 0.6
        if (n.fy != null) (n.y = n.fy), (n.vy = 0)
        else n.y! += n.vy! *= 0.6
      }
      return alpha >= 0.001 || target > 0
    },
  }
}

/** A settled, deterministic force layout scaled to fit the drawing box. */
export function forceLayout(g: Subgraph): Pos {
  const nodes: SimNode[] = g.nodes.map((n) => ({ id: n.id }))
  const st = stepper(nodes, [
    forceLink<SimNode, SimLink>(linksOf(g)).id((d) => d.id).distance(48).strength(0.7),
    forceManyBody<SimNode>().strength(-170),
    forceX<SimNode>(W / 2).strength(0.07),
    forceY<SimNode>(H / 2).strength(0.1),
    forceCollide<SimNode>(15),
  ])
  for (let i = 0; i < 300; i++) st.tick()
  const xs = nodes.map((n) => n.x!)
  const ys = nodes.map((n) => n.y!)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const k = Math.min(1.5, (W - 2 * PAD) / (x1 - x0 || 1), (H - 2 * PAD) / (y1 - y0 || 1))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return new Map(nodes.map((n) => [n.id, { x: W / 2 + (n.x! - cx) * k, y: H / 2 + (n.y! - cy) * k }]))
}

/** Wheel zoom and background pan (d3-zoom); dragging a node is left to the node. */
export function useZoom(ref: RefObject<SVGSVGElement | null>): string | undefined {
  const [t, setT] = useState<string>()
  useEffect(() => {
    const svg = ref.current
    if (!svg) return
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 4])
      .extent([[0, 0], [W, H]])
      .filter((e: Event) => {
        const m = e as MouseEvent
        return (!m.ctrlKey || e.type === 'wheel') && !m.button && !(e.target as Element | null)?.closest?.('.g-node')
      })
      .on('zoom', (e: { transform: { toString(): string } }) => setT(e.transform.toString()))
    const sel = select(svg)
    sel.call(z).on('dblclick.zoom', null)
    return () => {
      sel.on('.zoom', null)
    }
  }, [ref])
  return t
}

const delay = (i: number, base = 0) => `${base + Math.min(i, MAX_STAGGER) * STAGGER}ms`
const short = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s)

/** One node: pop-in wrapper, dark-only drift wrapper, dot, used ring, focus ring and (optionally) its name. */
export function NodeMark({
  n,
  x,
  y,
  i,
  onOpen,
  style,
  className = '',
  ring = n.used,
  filled = n.seed,
  label = n.used || n.seed,
  handlers,
}: {
  n: GraphNode
  x: number
  y: number
  i: number
  onOpen(): void
  style?: CSSProperties
  className?: string
  ring?: boolean
  filled?: boolean
  label?: boolean
  handlers?: React.SVGProps<SVGGElement>
}) {
  const r = n.seed ? 6.5 : 5
  return (
    <g
      className={`g-node ${className}`}
      transform={`translate(${x},${y})`}
      aria-label={nodeAria(n)}
      style={style}
      onClick={onOpen}
      {...activate(onOpen)}
      {...handlers}
    >
      <g className="g-pop" style={{ animationDelay: delay(i, 120) }}>
        <g className="g-drift" style={{ animationDelay: `${-(i % 7) * 0.9}s`, animationDirection: i % 2 ? 'alternate-reverse' : 'alternate' }}>
          <circle className="g-hit" r={r + 7} />
          <circle className="g-focus" r={r + 5} />
          <circle className={`g-ring${ring ? ' is-on' : ''}`} r={r + 3.2} />
          <circle className="g-dot" r={r} style={{ fill: filled ? 'var(--accent)' : cssColor(n.label) }} />
          {label && <text className="g-name" y={r + 12}>{short(n.name)}</text>}
          <title>{nodeAria(n)}</title>
        </g>
      </g>
    </g>
  )
}

export function Edges({
  g,
  pos,
  edgeClass,
  edgeStyle,
}: {
  g: Subgraph
  pos: Pos
  edgeClass(e: Subgraph['edges'][number]): string
  edgeStyle?(e: Subgraph['edges'][number]): CSSProperties | undefined
}) {
  const name = new Map(g.nodes.map((n) => [n.id, n.name]))
  return (
    <g className="g-edges">
      {g.edges.map((e, i) => {
        const a = pos.get(e.from)
        const b = pos.get(e.to)
        if (!a || !b) return null
        return (
          <line
            key={e.id}
            data-edge={e.id}
            className={`g-edge ${edgeClass(e)}`}
            pathLength={1}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            style={{ animationDelay: delay(i), ...edgeStyle?.(e) }}
          >
            <title>{`${name.get(e.from)} ${e.type.replace(/_/g, ' ').toLowerCase()} ${name.get(e.to)}`}</title>
          </line>
        )
      })}
    </g>
  )
}

export function Force({ subgraph, dim, onNodeOpen }: GraphViewProps) {
  const base = useMemo(() => forceLayout(subgraph), [subgraph])
  const [pos, setPos] = useState(base)
  const svgRef = useRef<SVGSVGElement>(null)
  const layerRef = useRef<SVGGElement>(null)
  const zoomT = useZoom(svgRef)
  const sim = useRef<{ st: Stepper; byId: Map<string, SimNode>; target: number; raf: number } | null>(null)
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null)
  /** True only between the pointerup that ends a drag and the click event the browser fires right after it. */
  const suppressClick = useRef(false)
  const suppressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** Nodes a drag has pinned where they were dropped; a double-click releases one. */
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set())

  // Reset to the settled layout whenever the subgraph changes; stop any live simulation on change/unmount.
  useEffect(() => {
    setPos(base)
    setPinned(new Set())
    return () => {
      if (sim.current?.raf) cancelAnimationFrame(sim.current.raf)
      sim.current = null
      drag.current = null
      suppressClick.current = false
      clearTimeout(suppressTimer.current)
    }
  }, [base])

  /** A gentle live simulation, built on first drag: links keep their current lengths, so neighbours follow and nothing jumps. */
  const liveSim = (from: Pos) => {
    if (sim.current) return sim.current
    const nodes: SimNode[] = subgraph.nodes.map((n) => ({ id: n.id, ...from.get(n.id)! }))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const links = linksOf(subgraph).map((l) => {
      const a = from.get(l.source as string)!
      const b = from.get(l.target as string)!
      return { ...l, len: Math.hypot(a.x - b.x, a.y - b.y) }
    })
    const st = stepper(nodes, [
      forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => l.len ?? 48).strength(0.25),
      forceCollide<SimNode>(15),
    ], 0.3)
    sim.current = { st, byId, target: 0, raf: 0 }
    return sim.current
  }

  // Step the live simulation once per frame until it settles; the unmount cleanup cancels it.
  const run = (live: NonNullable<typeof sim.current>) => {
    const frame = () => {
      const going = live.st.tick(live.target)
      setPos(new Map(live.st.nodes.map((n) => [n.id, { x: n.x!, y: n.y! }])))
      live.raf = going && sim.current === live ? requestAnimationFrame(frame) : 0
    }
    live.raf = requestAnimationFrame(frame)
  }

  const toLocal = (e: React.PointerEvent) => {
    const m = layerRef.current?.getScreenCTM?.()
    if (!m) return null
    const { a, b, c, d, e: tx, f: ty } = m.inverse()
    return { x: a * e.clientX + c * e.clientY + tx, y: b * e.clientX + d * e.clientY + ty }
  }

  function endDrag() {
    const dragged = drag.current?.moved
    drag.current = null
    if (sim.current) sim.current.target = 0 // the node stays where it was dropped (fx/fy kept)
    if (!dragged) return
    // Swallow the click that follows this pointerup, and only that one.
    suppressClick.current = true
    clearTimeout(suppressTimer.current)
    suppressTimer.current = setTimeout(() => {
      suppressClick.current = false
    }, 0)
  }

  const handlers = (id: string): React.SVGProps<SVGGElement> => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return
      drag.current = { id, x: e.clientX, y: e.clientY, moved: false }
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e) => {
      const d = drag.current
      if (!d || d.id !== id) return
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return
      d.moved = true
      const p = toLocal(e)
      if (!p) return
      const live = liveSim(pos)
      const node = live.byId.get(id)
      if (!node) return
      node.fx = p.x
      node.fy = p.y
      if (!pinned.has(id)) setPinned((s) => new Set(s).add(id))
      live.target = 0.12
      live.st.reheat(0.3)
      if (!live.raf) run(live)
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick: () => {
      const live = sim.current
      const node = live?.byId.get(id)
      if (!live || !node || !pinned.has(id)) return
      node.fx = null
      node.fy = null
      setPinned((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      live.target = 0
      live.st.reheat(0.3)
      if (!live.raf) run(live)
    },
  })

  const open = (id: string) => {
    if (suppressClick.current) return
    onNodeOpen(id)
  }

  return (
    <svg ref={svgRef} className="g-svg g-force" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={summary(subgraph)}>
      <g ref={layerRef} transform={zoomT}>
        <Edges
          g={subgraph}
          pos={pos}
          edgeClass={(e) => (e.used ? 'is-used' : '')}
          edgeStyle={(e) => ({ opacity: dimmed(dim, e.used) })}
        />
        <g className="g-nodes">
          {subgraph.nodes.map((n, i) => {
            const p = pos.get(n.id)
            if (!p) return null
            return (
              <NodeMark
                key={n.id}
                n={n}
                x={p.x}
                y={p.y}
                i={i}
                onOpen={() => open(n.id)}
                style={{ opacity: dimmed(dim, n.used) }}
                className={pinned.has(n.id) ? 'is-pinned' : ''}
                handlers={handlers(n.id)}
              />
            )
          })}
        </g>
      </g>
    </svg>
  )
}
