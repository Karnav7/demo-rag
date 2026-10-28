import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useReducedMotion } from '../theme/motion'
import { H, W } from './Force'
import { colorFor, DIM, nodeAria, useDocumentTheme, WEBGL_FALLBACK, type GraphNode, type GraphViewProps } from './graphStyle'
import { depthLabel, forceLayout3d, NodeKeys, readVar } from './space'

const SPREAD = 62 // world units for the layout's unit radius
const PER_EDGE = 3 // particles riding each used edge
const PARTICLE_SPEED = 0.22 // edge lengths per second: slow, like a pulse
const CLICK_SLOP = 4 // px a pointer may travel and still count as a click

/**
 * The direction to look from so the layout shows its broadest face: of a fixed spread of candidate
 * directions (upper hemisphere, slightly above the horizon), the one the points vary least along.
 */
export function viewAxis(points: { x: number; y: number; z: number }[]): Vector3 {
  let best = new Vector3(0, 0.35, 1).normalize()
  let bestVar = Infinity
  const N = 48
  for (let i = 0; i < N; i++) {
    const y = 0.15 + 0.6 * ((i + 0.5) / N) // keep the camera a little above the horizon
    const k = Math.sqrt(1 - y * y)
    const a = i * Math.PI * (3 - Math.sqrt(5))
    const d = new Vector3(k * Math.cos(a), y, k * Math.sin(a))
    const v = points.reduce((s, p) => s + (p.x * d.x + p.y * d.y + p.z * d.z) ** 2, 0)
    if (v < bestVar - 1e-9) (best = d), (bestVar = v)
  }
  return best
}

export const hasWebGL = () => typeof window !== 'undefined' && typeof window.WebGLRenderingContext !== 'undefined'

/** A soft round sprite: white core falling off to transparent, tinted by each material. */
function glowTexture(): Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.35, 'rgba(255,255,255,.45)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 64, 64)
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

interface World {
  restyle(): void
  highlight(id: string | null): void
}

/**
 * three.js view: a settled 3D force layout, used edges with particles flowing along them, orbit
 * controls (drag rotates, wheel zooms), raycast picking. Falls back to a note without WebGL.
 */
export function Three(props: GraphViewProps) {
  const [failed, setFailed] = useState(() => !hasWebGL())
  if (failed) return <p className="ev-empty">{WEBGL_FALLBACK}</p>
  return <Scene3d {...props} onFail={() => setFailed(true)} />
}

function Scene3d({ subgraph, dim, onNodeOpen, onFail }: GraphViewProps & { onFail(): void }) {
  const layout = useMemo(() => forceLayout3d(subgraph), [subgraph])
  const reduced = useReducedMotion()
  const theme = useDocumentTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const world = useRef<World | null>(null)
  // Latest values for the long-lived scene (read on restyle / each frame).
  const live = useRef({ dim, reduced, theme, onNodeOpen, onFail })
  live.current = { dim, reduced, theme, onNodeOpen, onFail }

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      live.current.onFail()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    const canvas = renderer.domElement
    canvas.className = 'g-depth__surface'
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', depthLabel('3D view', subgraph))
    wrap.prepend(canvas)

    const scene = new Scene()
    const camera = new PerspectiveCamera(42, W / H, 1, 2000)
    camera.position.copy(viewAxis([...layout.values()]).multiplyScalar(SPREAD * 2.75))
    scene.add(new AmbientLight(0xffffff, 1.6))
    const key = new DirectionalLight(0xffffff, 1.4)
    key.position.set(1, 1.4, 1.2)
    scene.add(key)

    const geometries: BufferGeometry[] = []
    const materials: Material[] = []
    const textures: Texture[] = []
    const track = <T extends BufferGeometry | Material | Texture>(x: T): T => {
      if (x instanceof BufferGeometry) geometries.push(x)
      else if ('isTexture' in x) textures.push(x as Texture)
      else materials.push(x as Material)
      return x
    }

    const at = (id: string) => {
      const p = layout.get(id)!
      return new Vector3(p.x * SPREAD, p.y * SPREAD, p.z * SPREAD)
    }
    const glow = track(glowTexture())
    const sphere = track(new SphereGeometry(1, 24, 16))
    const hitMat = track(new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }))

    // Nodes: a lit sphere each, a soft accent halo for used ones, and a larger invisible hit sphere.
    const nodes = subgraph.nodes.map((n) => {
      const mat = track(new MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, transparent: true }))
      const mesh = new Mesh(sphere, mat)
      const r = n.seed ? 4 : 3
      mesh.scale.setScalar(r)
      mesh.position.copy(at(n.id))
      scene.add(mesh)
      const hit = new Mesh(sphere, hitMat)
      hit.scale.setScalar(r + 4)
      hit.position.copy(mesh.position)
      hit.userData.id = n.id
      scene.add(hit)
      let halo: Sprite | null = null
      if (n.used) {
        halo = new Sprite(track(new SpriteMaterial({ map: glow, transparent: true, depthWrite: false })))
        halo.scale.setScalar(r * 6)
        halo.position.copy(mesh.position)
        scene.add(halo)
      }
      return { n, mesh, mat, hit, halo, r }
    })
    const nodeById = new Map(nodes.map((x) => [x.n.id, x]))
    const hits = nodes.map((x) => x.hit)

    // Edges: the grounding path and everything else, as two line batches.
    const edges = subgraph.edges.filter((e) => layout.has(e.from) && layout.has(e.to))
    const segs = (used: boolean) => {
      const list = edges.filter((e) => e.used === used)
      const arr = new Float32Array(list.length * 6)
      list.forEach((e, i) => {
        at(e.from).toArray(arr, i * 6)
        at(e.to).toArray(arr, i * 6 + 3)
      })
      const geo = track(new BufferGeometry())
      geo.setAttribute('position', new BufferAttribute(arr, 3))
      const line = new LineSegments(geo, track(new LineBasicMaterial({ transparent: true, depthWrite: false })))
      scene.add(line)
      return line
    }
    const usedLines = segs(true)
    const otherLines = segs(false)

    // Particles along used edges: created only while motion is allowed, removed under reduced motion.
    const paths = edges.filter((e) => e.used).map((e) => [at(e.from), at(e.to)] as const)
    let flow = 0
    let flowing: { points: Points; geo: BufferGeometry; mat: PointsMaterial; pos: Float32Array } | null = null
    const placeParticles = () => {
      if (!flowing) return
      const tmp = new Vector3()
      paths.forEach(([a, b], i) => {
        for (let k = 0; k < PER_EDGE; k++) {
          const t = (flow + k / PER_EDGE) % 1
          tmp.lerpVectors(a, b, t).toArray(flowing!.pos, (i * PER_EDGE + k) * 3)
        }
      })
      flowing.geo.attributes.position.needsUpdate = true
    }
    const startParticles = () => {
      if (flowing || !paths.length) return
      const geo = new BufferGeometry()
      const pos = new Float32Array(paths.length * PER_EDGE * 3)
      geo.setAttribute('position', new BufferAttribute(pos, 3))
      const mat = new PointsMaterial({ size: 4.5, map: glow, transparent: true, depthWrite: false, sizeAttenuation: true })
      flowing = { points: new Points(geo, mat), geo, mat, pos }
      scene.add(flowing.points)
      placeParticles()
    }
    const stopParticles = () => {
      if (!flowing) return
      scene.remove(flowing.points)
      flowing.geo.dispose()
      flowing.mat.dispose()
      flowing = null
    }

    // A ring under the focused/hovered node.
    const ringGeo = track(new BufferGeometry().setFromPoints(
      Array.from({ length: 49 }, (_, i) => new Vector3(Math.cos((i / 48) * Math.PI * 2), Math.sin((i / 48) * Math.PI * 2), 0)),
    ))
    const ringMat = track(new LineBasicMaterial({ transparent: true }))
    const ring = new Line(ringGeo, ringMat)
    ring.visible = false
    scene.add(ring)

    const controls = new OrbitControls(camera, canvas)
    controls.enablePan = false
    controls.minDistance = SPREAD * 1.2
    controls.maxDistance = SPREAD * 6
    controls.autoRotateSpeed = 0.35 // a full turn takes almost three minutes
    controls.rotateSpeed = 0.6
    controls.zoomSpeed = 0.7

    let raf = 0
    let last = 0
    let pending = 0
    const render = () => {
      ring.quaternion.copy(camera.quaternion)
      renderer.render(scene, camera)
    }
    const animating = () => !live.current.reduced
    const frame = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60
      last = now
      if (flowing) {
        flow = (flow + dt * PARTICLE_SPEED) % 1
        placeParticles()
      }
      controls.update(dt)
      render()
      raf = animating() ? requestAnimationFrame(frame) : 0
      if (!raf) last = 0
    }
    /** Without motion nothing loops; a change paints one frame. */
    const requestRender = () => {
      if (raf || pending) return
      pending = requestAnimationFrame(() => {
        pending = 0
        render()
      })
    }
    controls.addEventListener('change', requestRender)

    let hovered: string | null = null
    let focused: string | null = null
    const placeRing = () => {
      const id = focused ?? hovered
      const x = id ? nodeById.get(id) : undefined
      ring.visible = !!x
      if (x) {
        ring.position.copy(x.mesh.position)
        ring.scale.setScalar(x.r + 3)
      }
      const tip = tipRef.current
      if (tip) {
        if (x) {
          const p = x.mesh.position.clone().project(camera)
          tip.textContent = nodeAria(x.n)
          tip.style.transform = `translate(${((p.x + 1) / 2) * canvas.clientWidth}px, ${((1 - p.y) / 2) * canvas.clientHeight}px)`
          tip.dataset.on = 'true'
        } else {
          delete tip.dataset.on
        }
      }
      if (!raf) requestRender()
    }

    const restyle = () => {
      const { dim, reduced, theme } = live.current
      const dark = theme === 'dark'
      const accent = new Color(readVar('--accent', dark ? '#9aa6ff' : '#b5522d'))
      const mute = new Color(readVar('--mute', dark ? '#8b90a8' : '#8a8478'))
      const ink = new Color(readVar('--ink', dark ? '#e6e8f2' : '#2b2925'))
      const blending = dark ? AdditiveBlending : NormalBlending
      const fade = (n: GraphNode) => (dim && !n.used ? DIM : 1)
      for (const { n, mat, halo } of nodes) {
        const c = new Color(n.seed ? accent : colorFor(n.label))
        mat.color.copy(c)
        mat.emissive.copy(c).multiplyScalar(dark ? 0.35 : 0.12)
        mat.opacity = fade(n)
        if (halo) {
          const m = halo.material
          m.color.copy(accent)
          m.opacity = (dark ? 0.55 : 0.3) * fade(n)
          if (m.blending !== blending) (m.blending = blending), (m.needsUpdate = true)
        }
      }
      const um = usedLines.material as LineBasicMaterial
      um.color.copy(accent)
      um.opacity = 0.85
      const om = otherLines.material as LineBasicMaterial
      om.color.copy(mute)
      om.opacity = 0.38 * (dim ? DIM : 1)
      if (reduced) stopParticles()
      else startParticles()
      if (flowing) {
        const pm = flowing.mat
        pm.color.copy(accent)
        pm.opacity = dark ? 0.95 : 0.8
        if (pm.blending !== blending) (pm.blending = blending), (pm.needsUpdate = true)
      }
      ringMat.color.copy(ink)
      controls.autoRotate = !reduced && dark // ambient motion is dark-only, and never under reduced motion
      controls.enableDamping = !reduced
      if (!reduced && !raf) raf = requestAnimationFrame(frame)
      if (reduced && raf) (cancelAnimationFrame(raf), (raf = 0), (last = 0))
      requestRender()
    }

    // Picking: a click that did not travel opens the node under it; a drag only rotates.
    const ray = new Raycaster()
    const ndc = new Vector2()
    const hitAt = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect()
      if (!r.width || !r.height) return null
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return (ray.intersectObjects(hits, false)[0]?.object.userData.id as string | undefined) ?? null
    }
    let down: { x: number; y: number } | null = null
    let dragging = false
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
      dragging = true
    }
    const onUp = () => {
      dragging = false
    }
    const onMove = (e: PointerEvent) => {
      if (dragging) return
      const id = hitAt(e)
      if (id === hovered) return
      hovered = id
      canvas.style.cursor = id ? 'pointer' : ''
      placeRing()
    }
    const onLeave = () => {
      hovered = null
      canvas.style.cursor = ''
      placeRing()
    }
    const onClick = (e: MouseEvent) => {
      const from = down
      down = null
      if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) > CLICK_SLOP) return
      const id = hitAt(e)
      if (id) live.current.onNodeOpen(id)
    }
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('click', onClick)
    // A lost context (GPU reset, too many contexts) would leave a blank canvas: show the fallback instead.
    const onLost = (e: Event) => {
      e.preventDefault()
      live.current.onFail()
    }
    canvas.addEventListener('webglcontextlost', onLost)

    const size = () => {
      const w = wrap.clientWidth || W
      const h = Math.round((w * H) / W)
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      requestRender()
    }
    size()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(size)
    ro?.observe(wrap)

    world.current = {
      restyle,
      highlight: (id) => {
        focused = id
        placeRing()
      },
    }
    restyle()

    return () => {
      world.current = null
      cancelAnimationFrame(raf)
      cancelAnimationFrame(pending)
      ro?.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('webglcontextlost', onLost)
      stopParticles()
      controls.removeEventListener('change', requestRender)
      controls.dispose()
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [subgraph, layout])

  useEffect(() => {
    world.current?.restyle()
  }, [dim, reduced, theme])

  return (
    <div ref={wrapRef} className="g-depth">
      <div ref={tipRef} className="g-depth__tip" aria-hidden />
      <NodeKeys g={subgraph} onOpen={onNodeOpen} onFocusNode={(id) => world.current?.highlight(id)} />
    </div>
  )
}

export default Three
