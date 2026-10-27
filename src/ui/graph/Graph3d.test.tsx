import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Subgraph, TraceStage } from '../../domain/types'
import { GraphViews } from './GraphViews'
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
const KEY = 'dummy-rag.graph-variant'
const WEBGL = "3D view needs WebGL, which isn't available here."

beforeEach(() => {
  // jsdom has no canvas backend; silence its "not implemented" error and make the absence explicit.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
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

  it('Orbit: a drag rotates and never opens a node', async () => {
    localStorage.setItem(KEY, 'orbit')
    const onNodeOpen = vi.fn()
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={onNodeOpen} />)
    const canvas = await screen.findByRole('img', { name: /3 entities/ })
    fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 30, pointerId: 1 })
    fireEvent.click(canvas, { clientX: 60, clientY: 30 })
    expect(onNodeOpen).not.toHaveBeenCalled()
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
