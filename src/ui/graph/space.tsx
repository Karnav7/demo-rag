import type { Subgraph } from '../../domain/types'
import { nodeAria } from './graphStyle'

/** Shared pieces of the two depth views (Orbit canvas and three.js 3D). */

export interface P3 {
  x: number
  y: number
  z: number
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/** Evenly spread start points on a sphere (deterministic, no RNG). */
function fibonacci(i: number, n: number, r: number): P3 {
  const y = n === 1 ? 0 : 1 - (2 * (i + 0.5)) / n
  const k = Math.sqrt(1 - y * y)
  const a = i * GOLDEN
  return { x: r * k * Math.cos(a), y: r * y, z: r * k * Math.sin(a) }
}

/**
 * A small, synchronous 3D force layout (links, n-body repulsion, centring), settled before it is
 * returned and normalised so the farthest node sits at radius 1. Timer-free and deterministic for
 * the same reason as Force's `stepper`: no live simulation to drain, nothing random.
 */
export function forceLayout3d(g: Subgraph, ticks = 300): Map<string, P3> {
  const n = g.nodes.length
  if (!n) return new Map()
  const index = new Map(g.nodes.map((nd, i) => [nd.id, i]))
  const pos = g.nodes.map((_, i) => fibonacci(i, n, 20 * Math.cbrt(n)))
  const vel = g.nodes.map(() => ({ x: 0, y: 0, z: 0 }))
  const links = g.edges
    .map((e) => [index.get(e.from), index.get(e.to)] as const)
    .filter((l): l is readonly [number, number] => l[0] != null && l[1] != null && l[0] !== l[1])
  const degree = new Array<number>(n).fill(0)
  for (const [a, b] of links) {
    degree[a]++
    degree[b]++
  }

  const LEN = 40
  const REPEL = 900
  const GRAVITY = 0.08
  let alpha = 1
  const decay = 1 - Math.pow(0.001, 1 / ticks)
  for (let t = 0; t < ticks; t++) {
    alpha -= alpha * decay
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x
        const dy = pos[i].y - pos[j].y
        const dz = pos[i].z - pos[j].z
        const f = (REPEL * alpha) / Math.max(dx * dx + dy * dy + dz * dz, 1)
        vel[i].x += dx * f
        vel[i].y += dy * f
        vel[i].z += dz * f
        vel[j].x -= dx * f
        vel[j].y -= dy * f
        vel[j].z -= dz * f
      }
    }
    for (const [a, b] of links) {
      const dx = pos[b].x - pos[a].x
      const dy = pos[b].y - pos[a].y
      const dz = pos[b].z - pos[a].z
      const l = Math.hypot(dx, dy, dz) || 1
      // Split the correction by degree so hubs move less than leaves (as d3's forceLink does).
      const k = ((l - LEN) / l) * alpha * 0.7
      const wa = degree[b] / (degree[a] + degree[b])
      vel[a].x += dx * k * wa
      vel[a].y += dy * k * wa
      vel[a].z += dz * k * wa
      vel[b].x -= dx * k * (1 - wa)
      vel[b].y -= dy * k * (1 - wa)
      vel[b].z -= dz * k * (1 - wa)
    }
    for (let i = 0; i < n; i++) {
      const p = pos[i]
      const v = vel[i]
      // Centring strong enough that a disconnected seed stays near the cluster instead of drifting off.
      v.x = (v.x - p.x * GRAVITY * alpha) * 0.6
      v.y = (v.y - p.y * GRAVITY * alpha) * 0.6
      v.z = (v.z - p.z * GRAVITY * alpha) * 0.6
      p.x += v.x
      p.y += v.y
      p.z += v.z
    }
  }

  const c = pos.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n, z: s.z + p.z / n }), { x: 0, y: 0, z: 0 })
  const r = Math.max(...pos.map((p) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z)), 1e-9)
  return new Map(g.nodes.map((nd, i) => [nd.id, { x: (pos[i].x - c.x) / r, y: (pos[i].y - c.y) / r, z: (pos[i].z - c.z) / r }]))
}

/**
 * The force layout pushed onto the unit sphere, then relaxed on the shell: nodes repel each other
 * across the surface (so labels do not pile up) while links keep neighbours close. Deterministic.
 */
export function sphereLayout(g: Subgraph, iterations = 160): Map<string, P3> {
  const n = g.nodes.length
  const raw = forceLayout3d(g)
  const pts = g.nodes.map((nd, i) => {
    const p = raw.get(nd.id)!
    const l = Math.hypot(p.x, p.y, p.z)
    return l > 1e-3 ? { x: p.x / l, y: p.y / l, z: p.z / l } : fibonacci(i, n, 1)
  })
  const index = new Map(g.nodes.map((nd, i) => [nd.id, i]))
  const links = g.edges
    .map((e) => [index.get(e.from), index.get(e.to)] as const)
    .filter((l): l is readonly [number, number] => l[0] != null && l[1] != null && l[0] !== l[1])
  const step = 0.6 / Math.max(n, 4)
  for (let t = 0; t < iterations; t++) {
    const cool = 1 - t / iterations
    const f = pts.map(() => ({ x: 0, y: 0, z: 0 }))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pts[i].x - pts[j].x
        const dy = pts[i].y - pts[j].y
        const dz = pts[i].z - pts[j].z
        const k = 1 / Math.max(dx * dx + dy * dy + dz * dz, 1e-3)
        f[i].x += dx * k
        f[i].y += dy * k
        f[i].z += dz * k
        f[j].x -= dx * k
        f[j].y -= dy * k
        f[j].z -= dz * k
      }
    }
    for (const [a, b] of links) {
      const k = 1.5
      f[a].x += (pts[b].x - pts[a].x) * k
      f[a].y += (pts[b].y - pts[a].y) * k
      f[a].z += (pts[b].z - pts[a].z) * k
      f[b].x += (pts[a].x - pts[b].x) * k
      f[b].y += (pts[a].y - pts[b].y) * k
      f[b].z += (pts[a].z - pts[b].z) * k
    }
    pts.forEach((p, i) => {
      const x = p.x + f[i].x * step * cool
      const y = p.y + f[i].y * step * cool
      const z = p.z + f[i].z * step * cool
      const l = Math.hypot(x, y, z) || 1
      p.x = x / l
      p.y = y / l
      p.z = z / l
    })
  }
  return new Map(g.nodes.map((nd, i) => [nd.id, pts[i]]))
}

/** A theme token's resolved value (canvas and WebGL cannot use var()). */
export function readVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (v) return v
  } catch {
    // no DOM
  }
  return fallback
}

/** `#rgb`, `#rrggbb` or `rgb()/rgba()` → `rgba(r,g,b,a)`; anything else is returned unchanged. */
export function withAlpha(color: string, a: number): string {
  const c = color.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(c)
  if (m) {
    const [r, g, b] = m[1].split('').map((h) => parseInt(h + h, 16))
    return `rgba(${r},${g},${b},${a})`
  }
  m = /^#([0-9a-f]{6})$/i.exec(c)
  if (m) {
    const v = parseInt(m[1], 16)
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`
  }
  const rgb = /^rgba?\(([^,]+),([^,]+),([^,)]+)/i.exec(c)
  if (rgb) return `rgba(${rgb[1].trim()},${rgb[2].trim()},${rgb[3].trim()},${a})`
  return c
}

export const shortName = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s)

/** The accessible name of a depth view's drawing surface. */
export const depthLabel = (view: string, g: Subgraph) => {
  const n = g.nodes.length
  const used = g.nodes.filter((x) => x.used).length
  return `${view} of ${n} ${n === 1 ? 'entity' : 'entities'}, ${used} used in the answer. Drag to rotate, scroll to zoom.`
}

/**
 * The nodes of a canvas/WebGL view as real buttons, so keyboard and screen-reader users can open a
 * node's source exactly as a click on the drawing would. Visually hidden until one is focused, then
 * shown as a quiet strip over the bottom of the stage.
 */
export function NodeKeys({
  g,
  onOpen,
  onFocusNode,
}: {
  g: Subgraph
  onOpen(id: string): void
  onFocusNode?(id: string | null): void
}) {
  return (
    <ul className="g-keys" aria-label="Entities in this view">
      {g.nodes.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            className="g-key"
            onClick={() => onOpen(n.id)}
            onFocus={() => onFocusNode?.(n.id)}
            onBlur={() => onFocusNode?.(null)}
          >
            {nodeAria(n)}
          </button>
        </li>
      ))}
    </ul>
  )
}
