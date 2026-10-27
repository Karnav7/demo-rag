import { useEffect, useMemo, useRef } from 'react'
import { useReducedMotion } from '../theme/motion'
import { H, W } from './Force'
import { colorFor, DIM, useDocumentTheme, type GraphViewProps } from './graphStyle'
import { depthLabel, NodeKeys, readVar, shortName, sphereLayout, withAlpha, type P3 } from './space'

/** Camera distance in sphere radii: enough perspective for depth, not enough to distort. */
const CAMERA = 3.2
const SPIN = 0.045 // rad/s: one turn in a little over two minutes
const DRAG = 0.006 // rad per px
const PITCH_MAX = 1.25
const ZOOM_MIN = 0.6
const ZOOM_MAX = 2.4
const PICK = 12 // px beyond a node's radius that still counts as a hit

interface Projected {
  id: string
  x: number
  y: number
  r: number
  /** 0 at the back of the sphere, 1 at the front. */
  depth: number
}

function rotate(p: P3, yaw: number, pitch: number): P3 {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const x = p.x * cy + p.z * sy
  const z1 = -p.x * sy + p.z * cy
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  return { x, y: p.y * cp - z1 * sp, z: p.y * sp + z1 * cp }
}

/**
 * A dependency-free pseudo-3D view: nodes sit on a sphere and are projected with perspective;
 * depth sets size and opacity, used nodes carry a soft accent glow. Drag rotates, the wheel zooms.
 * In dark mode (the only theme with ambient motion) the sphere turns very slowly.
 */
export function Orbit({ subgraph, dim, onNodeOpen }: GraphViewProps) {
  const sphere = useMemo(() => sphereLayout(subgraph), [subgraph])
  const reduced = useReducedMotion()
  const theme = useDocumentTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const view = useRef({ yaw: 0.6, pitch: -0.28, zoom: 1, zoomTo: 1, spin: 0, inertia: 0 })
  const ui = useRef({ hover: null as string | null, focus: null as string | null, inside: false })
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  /** Set by a drag, consumed by the click that follows it. */
  const dragged = useRef(false)
  const proj = useRef<Projected[]>([])
  /** Schedules a repaint (and, with motion, keeps animating while anything is still moving). */
  const kick = useRef<() => void>(() => {})

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = canvas.getContext('2d')
    } catch {
      ctx = null
    }
    const dark = theme === 'dark'
    const colors = {
      accent: readVar('--accent', dark ? '#9aa6ff' : '#b5522d'),
      ink: readVar('--ink', dark ? '#e6e8f2' : '#2b2925'),
      mute: readVar('--mute', dark ? '#8b90a8' : '#8a8478'),
      node: new Map(subgraph.nodes.map((n) => [n.id, colorFor(n.label)])),
    }
    const byId = new Map(subgraph.nodes.map((n) => [n.id, n]))
    let w = W
    let h = H

    const size = () => {
      w = wrap.clientWidth || W
      h = Math.round((w * H) / W)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.height = `${h}px`
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const project = () => {
      const v = view.current
      const R = Math.min(w, h) * 0.34 * v.zoom
      const out: Projected[] = []
      for (const n of subgraph.nodes) {
        const p = rotate(sphere.get(n.id)!, v.yaw, v.pitch)
        const s = CAMERA / (CAMERA - p.z)
        const depth = (p.z + 1) / 2
        out.push({ id: n.id, x: w / 2 + p.x * s * R, y: h / 2 + p.y * s * R, r: (n.seed ? 6.5 : 5) * s * Math.sqrt(v.zoom), depth })
      }
      proj.current = out
      return out
    }

    const draw = () => {
      const pts = project()
      if (!ctx) return
      const c = ctx
      const at = new Map(pts.map((p) => [p.id, p]))
      const v = view.current
      c.clearRect(0, 0, w, h)

      // A faint equator: just enough to read the sphere's tilt.
      const R = Math.min(w, h) * 0.34 * v.zoom
      c.beginPath()
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2
        const p = rotate({ x: Math.cos(a), y: 0, z: Math.sin(a) }, v.yaw, v.pitch)
        const s = CAMERA / (CAMERA - p.z)
        const [x, y] = [w / 2 + p.x * s * R, h / 2 + p.y * s * R]
        if (i) c.lineTo(x, y)
        else c.moveTo(x, y)
      }
      c.strokeStyle = withAlpha(colors.mute, 0.14)
      c.lineWidth = 1
      c.setLineDash([2, 5])
      c.stroke()
      c.setLineDash([])

      // Edges, faded with depth; the grounding path in the accent colour.
      for (const e of subgraph.edges) {
        const a = at.get(e.from)
        const b = at.get(e.to)
        if (!a || !b) continue
        const depth = (a.depth + b.depth) / 2
        const alpha = (e.used ? 0.8 : 0.32) * (0.25 + 0.75 * depth) * (dim && !e.used ? DIM : 1)
        c.strokeStyle = withAlpha(e.used ? colors.accent : colors.mute, alpha)
        c.lineWidth = e.used ? 1.4 : 1
        c.beginPath()
        c.moveTo(a.x, a.y)
        c.lineTo(b.x, b.y)
        c.stroke()
      }

      // Nodes back to front.
      const { hover, focus } = ui.current
      for (const p of [...pts].sort((x, y) => x.depth - y.depth)) {
        const n = byId.get(p.id)!
        const alpha = (0.28 + 0.72 * p.depth) * (dim && !n.used ? DIM : 1)
        if (n.used) {
          const glow = c.createRadialGradient(p.x, p.y, p.r * 0.6, p.x, p.y, p.r * 3.4)
          glow.addColorStop(0, withAlpha(colors.accent, (dark ? 0.42 : 0.26) * alpha))
          glow.addColorStop(1, withAlpha(colors.accent, 0))
          c.fillStyle = glow
          c.beginPath()
          c.arc(p.x, p.y, p.r * 3.4, 0, Math.PI * 2)
          c.fill()
        }
        c.globalAlpha = alpha
        c.fillStyle = n.seed ? colors.accent : colors.node.get(n.id)!
        c.beginPath()
        c.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        c.fill()
        if (n.used && !n.seed) {
          c.strokeStyle = colors.accent
          c.lineWidth = 1.2
          c.beginPath()
          c.arc(p.x, p.y, p.r + 2.6, 0, Math.PI * 2)
          c.stroke()
        }
        const marked = p.id === hover || p.id === focus
        if (marked) {
          c.globalAlpha = 1
          c.strokeStyle = colors.ink
          c.lineWidth = 1.5
          c.beginPath()
          c.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2)
          c.stroke()
        }
        if (marked || ((n.used || n.seed) && p.depth > 0.4)) {
          c.globalAlpha = marked ? 1 : alpha * 0.85
          c.fillStyle = colors.ink
          c.font = '500 11px Inter, system-ui, sans-serif'
          c.textAlign = 'center'
          c.fillText(marked ? n.name : shortName(n.name), p.x, p.y + p.r + 13)
        }
        c.globalAlpha = 1
      }
    }

    let raf = 0
    let last = 0
    const frame = (now: number) => {
      const v = view.current
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60
      last = now
      // Ease the ambient spin in and out (it pauses while the pointer is over the sphere).
      const target = dark && !drag.current && !ui.current.inside ? SPIN : 0
      v.spin += (target - v.spin) * Math.min(1, dt * 1.5)
      v.yaw += (v.spin + v.inertia) * dt
      v.inertia *= Math.pow(0.05, dt) // a drag's release coasts to rest in about a second
      v.zoom += (v.zoomTo - v.zoom) * Math.min(1, dt * 8)
      draw()
      const moving = target > 0 || Math.abs(v.spin) > 1e-4 || Math.abs(v.inertia) > 1e-3 || Math.abs(v.zoomTo - v.zoom) > 1e-3
      raf = moving ? requestAnimationFrame(frame) : 0
      if (!moving) last = 0
    }
    kick.current = () => {
      if (reduced) {
        const v = view.current
        v.zoom = v.zoomTo
        v.spin = v.inertia = 0
        draw()
      } else if (!raf) {
        raf = requestAnimationFrame(frame)
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = view.current
      v.zoomTo = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoomTo * Math.exp(-e.deltaY * 0.0015)))
      kick.current()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })

    size()
    draw()
    kick.current()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => (size(), draw()))
    ro?.observe(wrap)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      kick.current = () => {}
    }
  }, [subgraph, sphere, dim, theme, reduced])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  /** The front-most node whose disc (plus a margin) contains the point. */
  const pick = (x: number, y: number) => {
    let best: Projected | null = null
    let bestD = Infinity
    for (const p of proj.current) {
      const d = Math.hypot(p.x - x, p.y - y)
      if (d > p.r + PICK) continue
      const score = d - p.depth * 6
      if (score < bestD) (best = p), (bestD = score)
    }
    return best?.id ?? null
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    dragged.current = false
    view.current.inertia = 0
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (d) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.hypot(dx, dy) < 3) return
      d.moved = dragged.current = true
      d.x = e.clientX
      d.y = e.clientY
      const v = view.current
      v.yaw += dx * DRAG
      v.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, v.pitch + dy * DRAG))
      v.inertia = reduced ? 0 : Math.max(-1.2, Math.min(1.2, dx * DRAG * 30))
      kick.current()
      return
    }
    const { x, y } = local(e)
    const hover = pick(x, y)
    if (hover !== ui.current.hover) {
      ui.current.hover = hover
      e.currentTarget.style.cursor = hover ? 'pointer' : ''
      kick.current()
    }
  }
  const endDrag = () => {
    drag.current = null
    kick.current()
  }
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    const { x, y } = local(e)
    const id = pick(x, y)
    if (id) onNodeOpen(id)
  }

  return (
    <div ref={wrapRef} className="g-depth">
      <canvas
        ref={canvasRef}
        className="g-depth__surface"
        role="img"
        aria-label={depthLabel('Orbit view', subgraph)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerEnter={() => {
          ui.current.inside = true
          kick.current()
        }}
        onPointerLeave={() => {
          ui.current.inside = false
          ui.current.hover = null
          kick.current()
        }}
        onClick={onClick}
      />
      <NodeKeys
        g={subgraph}
        onOpen={onNodeOpen}
        onFocusNode={(id) => {
          ui.current.focus = id
          kick.current()
        }}
      />
    </div>
  )
}

export default Orbit
