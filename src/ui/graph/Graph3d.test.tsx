import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Subgraph, TraceStage } from '../../domain/types'
import { GraphViews } from './GraphViews'
import { BufferGeometry, Material, Texture } from 'three'
import { H, W } from './Force'
import { Three } from './Three'
import { ORBIT_START, projectNodes } from './Orbit'
import { forceLayout3d, sphereLayout } from './space'

const node = (id: string, label: Subgraph['nodes'][number]['label'], name: string, used: boolean, seed = false) =>
  ({ id, label, name, props: {}, used, seed })
const edge = (id: string, from: string, to: string, used: boolean) =>
  ({ id, type: 'OWNS' as const, from, to, confidence: 0.9, section_id: 'sec-1', props: {}, used })

const subgraph: Subgraph = {
  nodes: [
    node('p1', 'Person', 'Ada Vance', true, true),
    node('c1', 'Company', 'Meridian Ltd', true),
    node('a1', 'Account', 'Acct 0042', false),
  ],
  edges: [edge('e1', 'p1', 'c1', true), edge('e2', 'c1', 'a1', false)],
}
const trace: TraceStage[] = []

// A stand-in WebGLRenderer (jsdom has no GL) over the real three.js scene graph; Points are counted.
const gl = vi.hoisted(() => ({ throws: false, points: 0, renderers: [] as {
    domElement: HTMLCanvasElement
    render: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    forceContextLoss: ReturnType<typeof vi.fn>
  }[],
}))
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeRenderer {
    domElement = document.createElement('canvas')
    setPixelRatio = vi.fn()
    setClearColor = vi.fn()
    setSize = vi.fn()
    render = vi.fn()
    dispose = vi.fn()
    forceContextLoss = vi.fn()
    constructor() {
      if (gl.throws) throw new Error('Error creating WebGL context.')
      gl.renderers.push(this)
    }
  }
  class CountingPoints extends actual.Points {
    constructor(geometry?: unknown, material?: unknown) {
      super(geometry as never, material as never)
      gl.points++
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer, Points: CountingPoints }
})
const motionFlags = vi.hoisted(() => ({ reduced: false }))
vi.mock('../theme/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../theme/motion')>()),
  useReducedMotion: () => motionFlags.reduced,
}))

/** A manual rAF queue: frames run only when flushed. */
function frames() {
  const queue = new Map<number, FrameRequestCallback>()
  let id = 0
  const raf = vi.fn((cb: FrameRequestCallback) => (queue.set(++id, cb), id))
  const caf = vi.fn((h: number) => void queue.delete(h))
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', caf)
  return {
    queue,
    caf,
    flush: () =>
      act(() => {
        const due = [...queue.values()]
        queue.clear()
        due.forEach((cb) => cb(performance.now()))
      }),
  }
}
const KEY = 'dummy-rag.graph-variant'
const WEBGL = "3D view needs WebGL, which isn't available here."

beforeEach(() => {
  // jsdom has no canvas backend; silence its "not implemented" error and make the absence explicit.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  gl.throws = false
  gl.points = 0
  gl.renderers.length = 0
  motionFlags.reduced = false
  vi.unstubAllGlobals()
  vi.doUnmock('./Three')
  vi.resetModules()
})

describe('Orbit and 3D views', () => {
  it('3D shows WebGL fallback in jsdom', async () => {
    localStorage.setItem(KEY, 'three')
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={() => {}} />)
    expect(await screen.findByText(WEBGL)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '3D' })).toBeChecked()
  })

  it('lazy import failure shows fallback and other variants still switch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    vi.doMock('./Three', () => {
      throw new Error('chunk failed to load')
    })
    const { GraphViews: Fresh } = await import('./GraphViews')
    localStorage.setItem(KEY, 'three')
    const onNodeOpen = vi.fn()
    render(<Fresh subgraph={subgraph} trace={trace} onNodeOpen={onNodeOpen} />)
    expect(await screen.findByText(WEBGL)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Force' }))
    await user.click(await screen.findByRole('button', { name: 'Meridian Ltd (Company)' }))
    expect(onNodeOpen).toHaveBeenCalledWith('c1')
    expect(screen.queryByText(WEBGL)).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Orbit' }))
    expect(await screen.findByRole('img', { name: /3 entities/ })).toBeInTheDocument()
  })

  it('Orbit renders a canvas with role="img" and an aria-label naming node count', async () => {
    localStorage.setItem(KEY, 'orbit')
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={() => {}} />)
    const canvas = await screen.findByRole('img', { name: /3 entities/ })
    expect(canvas.tagName).toBe('CANVAS')
  })

  it('Orbit keeps every node openable from the keyboard', async () => {
    localStorage.setItem(KEY, 'orbit')
    const onNodeOpen = vi.fn()
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={onNodeOpen} />)
    const btn = await screen.findByRole('button', { name: 'Acct 0042 (Account)' })
    btn.focus()
    await userEvent.setup().keyboard('{Enter}')
    expect(onNodeOpen).toHaveBeenCalledWith('a1')
  })

  it('Orbit: a click on a node opens it; a drag ending on the same node never does', async () => {
    // Give the stage a real size so the canvas projects exactly as computed below.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(W)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) } as DOMRect,
    )
    const front = projectNodes(subgraph.nodes, sphereLayout(subgraph), ORBIT_START, W, H).sort((a, b) => b.depth - a.depth)[0]
    localStorage.setItem(KEY, 'orbit')
    const onNodeOpen = vi.fn()
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={onNodeOpen} />)
    const canvas = await screen.findByRole('img', { name: /3 entities/ })
    const at = { clientX: front.x, clientY: front.y }

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, ...at })
    fireEvent.pointerUp(canvas, { pointerId: 1, ...at })
    fireEvent.click(canvas, at)
    expect(onNodeOpen).toHaveBeenCalledTimes(1)
    expect(onNodeOpen).toHaveBeenCalledWith(front.id)

    // Out and back: the net rotation is zero, so the node is under the pointer again when the click lands.
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, ...at })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: front.x + 40, clientY: front.y })
    fireEvent.pointerMove(canvas, { pointerId: 1, ...at })
    fireEvent.pointerUp(canvas, { pointerId: 1, ...at })
    fireEvent.click(canvas, at)
    expect(onNodeOpen).toHaveBeenCalledTimes(1)
  })

  it('3D layout is deterministic, finite and keeps linked nodes closer than unlinked ones', () => {
    const a = forceLayout3d(subgraph)
    const b = forceLayout3d(subgraph)
    expect([...a.entries()]).toEqual([...b.entries()])
    for (const p of a.values()) expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true)
    const d = (u: string, v: string) => Math.hypot(a.get(u)!.x - a.get(v)!.x, a.get(u)!.y - a.get(v)!.y, a.get(u)!.z - a.get(v)!.z)
    expect(d('p1', 'c1')).toBeLessThan(d('p1', 'a1'))
  })

  it('Orbit sphere layout puts every node on the unit sphere, deterministically', () => {
    const s = sphereLayout(subgraph)
    expect([...s.entries()]).toEqual([...sphereLayout(subgraph).entries()])
    for (const p of s.values()) expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 6)
  })
})

describe('3D scene lifecycle (mocked WebGL renderer)', () => {
  beforeEach(() => {
    vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {})
  })

  it('runs a frame loop with particles, then disposes everything and stops the loop on unmount', () => {
    const f = frames()
    const geo = vi.spyOn(BufferGeometry.prototype, 'dispose')
    const mat = vi.spyOn(Material.prototype, 'dispose')
    const tex = vi.spyOn(Texture.prototype, 'dispose')
    const { unmount } = render(<Three subgraph={subgraph} dim={false} onNodeOpen={() => {}} />)
    expect(gl.renderers).toHaveLength(1)
    const r = gl.renderers[0]
    expect(screen.getByRole('img', { name: /3D view of 3 entities/ })).toBe(r.domElement)
    expect(gl.points).toBe(1) // one Points batch for the used edge
    f.flush()
    expect(r.render).toHaveBeenCalled()
    expect(f.queue.size).toBeGreaterThan(0) // the loop re-queued itself

    unmount()
    expect(f.caf).toHaveBeenCalled()
    expect(r.dispose).toHaveBeenCalledTimes(1)
    expect(r.forceContextLoss).toHaveBeenCalledTimes(1)
    expect(r.domElement.isConnected).toBe(false)
    // sphere + 2 edge batches + ring + particles; one material per node, halos, lines, hit, ring, particles
    expect(geo.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(mat.mock.calls.length).toBeGreaterThanOrEqual(subgraph.nodes.length + 4)
    expect(tex).toHaveBeenCalled()
    const rendersAtUnmount = r.render.mock.calls.length
    f.flush()
    expect(r.render.mock.calls.length).toBe(rendersAtUnmount)
  })

  it('under reduced motion: no particles and no frame loop, only on-demand paints', () => {
    motionFlags.reduced = true
    const f = frames()
    render(<Three subgraph={subgraph} dim={false} onNodeOpen={() => {}} />)
    expect(gl.points).toBe(0)
    f.flush()
    expect(gl.renderers[0].render).toHaveBeenCalled()
    expect(f.queue.size).toBe(0)
    f.flush()
    expect(f.queue.size).toBe(0)
  })

  it('a renderer that cannot start shows the WebGL fallback', () => {
    gl.throws = true
    frames()
    render(<Three subgraph={subgraph} dim={false} onNodeOpen={() => {}} />)
    expect(screen.getByText(WEBGL)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('a lost WebGL context swaps to the fallback and releases the renderer', () => {
    frames()
    render(<Three subgraph={subgraph} dim={false} onNodeOpen={() => {}} />)
    const r = gl.renderers[0]
    const lost = new Event('webglcontextlost', { cancelable: true })
    act(() => {
      r.domElement.dispatchEvent(lost)
    })
    expect(lost.defaultPrevented).toBe(true)
    expect(screen.getByText(WEBGL)).toBeInTheDocument()
    expect(r.dispose).toHaveBeenCalledTimes(1)
  })
})
