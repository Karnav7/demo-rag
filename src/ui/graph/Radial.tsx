import { useMemo, useRef } from 'react'
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import type { Subgraph } from '../../domain/types'
import { H, NodeMark, W, useZoom } from './Force'
import { LABEL_ORDER, dimmed, edgeTint, labelName, summary, type GraphNode, type GraphViewProps } from './graphStyle'
import { nodeRisk } from '../theme/scale'

/** Tree datum: the root "Graph", a jurisdiction, a label group, or an entity. */
interface Datum {
  key: string
  name: string
  node?: GraphNode
  children?: Datum[]
}

const NONE = '__none'

/** Jurisdiction → entity type → entity, under a root "Graph". Jurisdiction nodes are the jurisdiction level itself. */
export function radialTree(g: Subgraph): Datum {
  const jurNodes = new Map(g.nodes.filter((n) => n.label === 'Jurisdiction').map((n) => [n.jurisdiction ?? n.id, n]))
  const groups = new Map<string, GraphNode[]>()
  for (const k of jurNodes.keys()) groups.set(k, [])
  for (const n of g.nodes) {
    if (n.label === 'Jurisdiction') continue
    const k = n.jurisdiction ?? NONE
    groups.set(k, [...(groups.get(k) ?? []), n])
  }
  const children: Datum[] = [...groups].map(([k, members]) => {
    const byLabel = LABEL_ORDER.map((l) => ({ l, ns: members.filter((n) => n.label === l) })).filter((x) => x.ns.length)
    return {
      key: `j:${k}`,
      name: jurNodes.get(k)?.name ?? (k === NONE ? 'No jurisdiction' : k),
      node: jurNodes.get(k),
      children: byLabel.map(({ l, ns }) => ({
        key: `j:${k}/l:${l}`,
        name: labelName(l),
        children: ns.map((n) => ({ key: n.id, name: n.name, node: n })),
      })),
    }
  })
  return { key: 'root', name: 'Graph', children }
}

const R = Math.min(W, H) / 2 - 26
const polar = (a: number, r: number) => ({ x: W / 2 + r * Math.cos(a - Math.PI / 2), y: H / 2 + r * Math.sin(a - Math.PI / 2) })

export function Radial({ subgraph, dim, onNodeOpen }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomT = useZoom(svgRef)
  const root = useMemo(() => {
    const h = hierarchy(radialTree(subgraph))
    return tree<Datum>()
      .size([2 * Math.PI, R])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(a.depth, 1))(h)
  }, [subgraph])

  // A branch counts as used when any entity beneath it (or the branch's own node) was used.
  const used = (d: HierarchyPointNode<Datum>) => d.data.node?.used || d.leaves().some((l) => l.data.node?.used)
  const pt = (d: HierarchyPointNode<Datum>) => (d.depth ? polar(d.x, d.y) : { x: W / 2, y: H / 2 })
  const links = root.links()
  // The graph's own relationships, drawn across the tree as dashed curves bowed toward the centre.
  const at = new Map(root.descendants().flatMap((d) => (d.data.node ? [[d.data.node.id, pt(d)] as const] : [])))
  const name = new Map(subgraph.nodes.map((n) => [n.id, n.name]))
  const cross = subgraph.edges.flatMap((e) => {
    const a = at.get(e.from)
    const b = at.get(e.to)
    if (!a || !b) return []
    const c = { x: W / 2 + ((a.x + b.x) / 2 - W / 2) * 0.35, y: H / 2 + ((a.y + b.y) / 2 - H / 2) * 0.35 }
    return [{ e, d: `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}` }]
  })
  let order = 0

  return (
    <svg ref={svgRef} className="g-svg g-radial" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={summary(subgraph)}>
      <g transform={zoomT}>
        <g className="g-edges">
          {links.map(({ source, target }, i) => {
            const a = pt(source)
            const b = pt(target)
            return (
              <line
                key={target.data.key}
                className={`g-edge g-edge--tree${target.data.node?.used ? ' is-used' : ''}`}
                pathLength={1}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                style={{ animationDelay: `${Math.min(i, 24) * 30}ms`, opacity: dimmed(dim, !!used(target)) }}
              />
            )
          })}
          {cross.map(({ e, d }) => (
            <path
              key={e.id}
              className={`g-edge g-edge--cross${e.used ? ' is-used' : ''}`}
              d={d}
              style={{ opacity: dimmed(dim, e.used), ...edgeTint(e) }}
            >
              <title>{`${name.get(e.from)} ${e.type.replace(/_/g, ' ').toLowerCase()} ${name.get(e.to)}`}</title>
            </path>
          ))}
        </g>
        <g className="g-nodes">
          {root.descendants().map((d) => {
            const p = pt(d)
            const n = d.data.node
            if (n) {
              return (
                <NodeMark
                  key={d.data.key}
                  n={n}
                  x={p.x}
                  y={p.y}
                  i={order++}
                  onOpen={() => onNodeOpen(n.id)}
                  style={{ opacity: dimmed(dim, n.used) }}
                  label={n.label === 'Jurisdiction' || n.used || n.seed}
                  risk={nodeRisk(subgraph, n)}
                />
              )
            }
            const outward = d.depth > 0 && Math.cos(d.x) < 0 ? 12 : -8
            return (
              <g
                key={d.data.key}
                className={`g-group${d.depth ? '' : ' g-group--root'}`}
                transform={`translate(${p.x},${p.y})`}
                style={{ opacity: dimmed(dim, !!used(d)) }}
                aria-hidden
              >
                <g className="g-pop" style={{ animationDelay: `${120 + Math.min(order++, 24) * 30}ms` }}>
                  <circle r={d.depth ? 3 : 4} />
                  <text y={d.depth ? outward : -9}>{d.data.name}</text>
                </g>
              </g>
            )
          })}
        </g>
      </g>
    </svg>
  )
}
