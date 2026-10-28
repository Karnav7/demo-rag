import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Subgraph, TraceStage } from '../../domain/types'
import { Force } from './Force'
import { GraphViews } from './GraphViews'
import { radialTree } from './Radial'
import { Replay, replaySteps } from './Replay'
import { LABEL_ORDER, NODE_LABELS, colorFor, firstCitedSection } from './graphStyle'

const motionFlags = vi.hoisted(() => ({ reduced: false }))
vi.mock('../theme/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../theme/motion')>()),
  useReducedMotion: () => motionFlags.reduced,
}))
afterEach(() => {
  motionFlags.reduced = false
  vi.useRealTimers()
})

const node = (id: string, label: Subgraph['nodes'][number]['label'], name: string, used: boolean, seed = false) =>
  ({ id, label, name, props: {}, used, seed })
const edge = (id: string, from: string, to: string, used: boolean, section_id: string | null) =>
  ({ id, type: 'OWNS' as const, from, to, confidence: 0.9, section_id, props: {}, used })

const subgraph: Subgraph = {
  nodes: [
    node('p1', 'Person', 'Ada Vance', true, true),
    node('c1', 'Company', 'Meridian Ltd', true),
    node('a1', 'Account', 'Acct 0042', false),
  ],
  edges: [edge('e1', 'p1', 'c1', true, 'sec-1'), edge('e2', 'c1', 'a1', false, null)],
}
const trace: TraceStage[] = [
  { id: 'lexical', title: 'Lexical search', ms: 3, detail: '1 hit on entity names and aliases. Top: Ada Vance (1.00).' },
  { id: 'seeds', title: 'Seed selection', ms: 1, detail: '1 seed: Ada Vance (Person).' },
  { id: 'expand', title: 'Expand', ms: 4, detail: 'two hops' },
]
const KEY = 'dummy-rag.graph-variant'

describe('Graph views', () => {
  it('variant persists to dummy-rag.graph-variant', async () => {
    const { unmount } = render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={() => {}} />)
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Radial' }))
    expect(localStorage.getItem(KEY)).toBe('radial')
    unmount()
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Radial' })).toBeChecked()
  })

  it('invalid stored variant falls back to force', () => {
    localStorage.setItem(KEY, 'hyperbolic')
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Force' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Radial' })).not.toBeChecked()
  })

  it('dim toggle sets unused opacity', async () => {
    const { container } = render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={() => {}} />)
    const unused = screen.getByRole('button', { name: 'Acct 0042 (Account)' })
    const used = screen.getByRole('button', { name: 'Ada Vance (Person)' })
    expect(unused).not.toHaveStyle({ opacity: '0.15' })
    const dim = screen.getByRole('switch', { name: 'Dim everything the answer did not use' })
    await userEvent.setup().click(dim)
    expect(dim).toBeChecked()
    expect(unused).toHaveStyle({ opacity: '0.15' })
    expect(used).not.toHaveStyle({ opacity: '0.15' })
    expect(container.querySelector('[data-edge="e2"]')).toHaveStyle({ opacity: '0.15' })
    expect(container.querySelector('[data-edge="e1"]')).not.toHaveStyle({ opacity: '0.15' })
  })

  it('node click calls onNodeOpen with id', async () => {
    const onNodeOpen = vi.fn()
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={onNodeOpen} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Meridian Ltd (Company)' }))
    expect(onNodeOpen).toHaveBeenCalledWith('c1')
    screen.getByRole('button', { name: 'Ada Vance (Person)' }).focus()
    await user.keyboard('{Enter}')
    expect(onNodeOpen).toHaveBeenLastCalledWith('p1')
  })

  it('empty subgraph shows message', () => {
    render(<GraphViews subgraph={{ nodes: [], edges: [] }} trace={trace} onNodeOpen={() => {}} />)
    expect(screen.getByText('No graph for this answer.')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('legend lists only present labels', () => {
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={() => {}} />)
    const items = within(screen.getByRole('list', { name: 'Node types' })).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(['Person', 'Company', 'Account'])
  })

  it('svg summarises counts; radial keeps nodes openable', async () => {
    const onNodeOpen = vi.fn()
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={onNodeOpen} />)
    expect(screen.getByLabelText('Subgraph: 3 entities, 2 relationships, 1 used in the answer')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Radial' }))
    await user.click(await screen.findByRole('button', { name: 'Acct 0042 (Account)' }))
    expect(onNodeOpen).toHaveBeenCalledWith('a1')
  })

  it('first cited section prefers used edges and falls back to any cited edge', () => {
    const g: Subgraph = {
      nodes: subgraph.nodes,
      edges: [edge('x', 'c1', 'a1', false, 'sec-9'), edge('y', 'c1', 'p1', true, 'sec-3'), edge('z', 'a1', 'p1', true, null)],
    }
    expect(firstCitedSection(g, 'c1')).toBe('sec-3')
    expect(firstCitedSection(g, 'a1')).toBe('sec-9')
    expect(firstCitedSection({ nodes: g.nodes, edges: [g.edges[2]] }, 'a1')).toBeNull()
  })

  it('colorFor falls back to a colour when the token is missing', () => {
    expect(colorFor('Person')).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('every NodeLabel has a --node-* token in both themes', async () => {
    // Vitest stubs CSS imports (even ?raw), so read the file itself; node types are not in this tsconfig.
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(p: string, enc: 'utf8'): string }
    const tokensCss = fs.readFileSync('src/ui/theme/tokens.css', 'utf8') // vitest runs from the repo root
    expect(NODE_LABELS).toHaveLength(13)
    expect([...LABEL_ORDER].sort()).toEqual([...NODE_LABELS].sort())
    const light = tokensCss.slice(tokensCss.indexOf(":root[data-theme='light']"), tokensCss.indexOf(":root[data-theme='dark']"))
    const darkStart = tokensCss.indexOf(":root[data-theme='dark']")
    const dark = tokensCss.slice(darkStart, tokensCss.indexOf('}', darkStart))
    for (const l of NODE_LABELS) {
      expect(light, `light --node-${l}`).toMatch(new RegExp(`--node-${l}:\\s*#[0-9a-f]{6};`, 'i'))
      expect(dark, `dark --node-${l}`).toMatch(new RegExp(`--node-${l}:\\s*#[0-9a-f]{6};`, 'i'))
    }
  })

  it('replaySteps: hits, then seeds, then expansion by hop, then used facts', () => {
    const steps = replaySteps(subgraph, trace)
    expect(steps.map((s) => s.title)).toEqual(['Lexical hits', 'Seeds', 'Expansion · 1 hop', 'Expansion · 2 hops', 'Used facts'])
    expect(steps.map((s) => s.nodes)).toEqual([['p1'], ['p1'], ['c1'], ['a1'], ['p1', 'c1']])
    expect(steps.map((s) => s.edges)).toEqual([[], [], ['e1'], ['e2'], ['e1']])
    const both = replaySteps(subgraph, [...trace, { id: 'vector', title: 'Vector', ms: 1, detail: 'Top: Acct 0042 (0.9).' }])
    expect(both[0]).toMatchObject({ title: 'Lexical and vector hits', nodes: ['p1', 'a1'] })
    expect(replaySteps(subgraph, trace.filter((t) => t.id !== 'lexical'))[0].title).toBe('Seeds')
  })

  it('radialTree: Graph → jurisdiction → label → entity', () => {
    const g: Subgraph = {
      nodes: [
        { ...node('j', 'Jurisdiction', 'United Kingdom', false), jurisdiction: 'UK' },
        { ...node('c', 'Company', 'Meridian Ltd', true), jurisdiction: 'UK' },
        { ...node('p', 'Person', 'Ada Vance', true), jurisdiction: 'UK' },
        node('a', 'Account', 'Acct 0042', false),
      ],
      edges: [],
    }
    const root = radialTree(g)
    expect(root.name).toBe('Graph')
    expect(root.children!.map((j) => j.name)).toEqual(['United Kingdom', 'No jurisdiction'])
    const uk = root.children![0]
    expect(uk.node?.id).toBe('j')
    expect(uk.children!.map((l) => l.name)).toEqual(['Person', 'Company'])
    expect(uk.children!.map((l) => l.children!.map((e) => e.node?.id))).toEqual([['p'], ['c']])
    expect(root.children![1].children!.map((l) => [l.name, l.children!.map((e) => e.name)])).toEqual([['Account', ['Acct 0042']]])
  })

  it('replay plays one step per 700 ms; pause stops; restart returns to the start', () => {
    vi.useFakeTimers()
    const { container } = render(<Replay subgraph={subgraph} trace={trace} dim={false} onNodeOpen={() => {}} />)
    const caption = () => container.querySelector('.g-replay__step')!.textContent
    const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
    expect(caption()).toBe('Retrieval replay')
    tick(300)
    expect(caption()).toBe('1/5Lexical hits')
    tick(699)
    expect(caption()).toBe('1/5Lexical hits')
    tick(1)
    expect(caption()).toBe('2/5Seeds')
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    tick(5000)
    expect(caption()).toBe('2/5Seeds')
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    tick(700)
    expect(caption()).toBe('3/5Expansion · 1 hop')
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(caption()).toBe('Retrieval replay')
    tick(300)
    expect(caption()).toBe('1/5Lexical hits')
    for (let k = 0; k < 4; k++) tick(700)
    expect(caption()).toBe('5/5Used facts')
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('reduced motion: replay shows the final state with step buttons', () => {
    motionFlags.reduced = true
    vi.useFakeTimers()
    const { container } = render(<Replay subgraph={subgraph} trace={trace} dim={false} onNodeOpen={() => {}} />)
    const caption = () => container.querySelector('.g-replay__step')!.textContent
    expect(caption()).toBe('5/5Used facts')
    expect(screen.queryByRole('button', { name: /Play|Pause/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(caption()).toBe('5/5Used facts')
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))
    expect(caption()).toBe('4/5Expansion · 2 hops')
    expect(screen.getByRole('button', { name: 'Ada Vance (Person)' })).toHaveClass('is-lit')
  })

  describe('Force drag', () => {
    const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    const withCTM = () => {
      Object.defineProperty(SVGElement.prototype, 'getScreenCTM', { configurable: true, value: () => ({ inverse: () => identity }) })
      return () => { delete (SVGElement.prototype as unknown as Record<string, unknown>).getScreenCTM }
    }
    const drag = (el: Element) => {
      fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
      fireEvent.pointerMove(el, { clientX: 30, clientY: 25, pointerId: 1 })
      fireEvent.pointerUp(el, { clientX: 30, clientY: 25, pointerId: 1 })
    }

    it('a drag pins the node; a double-click releases it', () => {
      const restore = withCTM()
      vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
      try {
        render(<Force subgraph={subgraph} dim={false} onNodeOpen={() => {}} />)
        const el = screen.getByRole('button', { name: 'Meridian Ltd (Company)' })
        const other = screen.getByRole('button', { name: 'Ada Vance (Person)' })
        fireEvent.doubleClick(el) // nothing pinned yet: a no-op
        expect(el).not.toHaveClass('is-pinned')
        drag(el)
        expect(el).toHaveClass('is-pinned')
        expect(other).not.toHaveClass('is-pinned')
        fireEvent.doubleClick(other) // releasing an unpinned node changes nothing
        expect(el).toHaveClass('is-pinned')
        fireEvent.doubleClick(el)
        expect(el).not.toHaveClass('is-pinned')
      } finally {
        restore()
      }
    })

    it('a drag does not open the node; a plain click (even right after) does', async () => {
      const restore = withCTM()
      vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
      try {
        const onNodeOpen = vi.fn()
        render(<Force subgraph={subgraph} dim={false} onNodeOpen={onNodeOpen} />)
        const el = screen.getByRole('button', { name: 'Meridian Ltd (Company)' })
        drag(el)
        fireEvent.click(el) // the click the browser fires after a drag
        expect(onNodeOpen).not.toHaveBeenCalled()
        drag(el) // a drag that ends without a click must not swallow the next real click
        await act(() => new Promise((r) => setTimeout(r, 0)))
        fireEvent.pointerDown(el, { button: 0, clientX: 5, clientY: 5, pointerId: 1 })
        fireEvent.pointerMove(el, { clientX: 6, clientY: 6, pointerId: 1 }) // under the 3 px threshold
        fireEvent.pointerUp(el, { clientX: 6, clientY: 6, pointerId: 1 })
        fireEvent.click(el)
        expect(onNodeOpen).toHaveBeenCalledTimes(1)
        expect(onNodeOpen).toHaveBeenCalledWith('c1')
      } finally {
        restore()
      }
    })

    it('unmount during a live simulation cancels its animation frame', () => {
      const restore = withCTM()
      const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42)
      const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
      try {
        const { unmount } = render(<Force subgraph={subgraph} dim={false} onNodeOpen={() => {}} />)
        const el = screen.getByRole('button', { name: 'Ada Vance (Person)' })
        fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
        fireEvent.pointerMove(el, { clientX: 40, clientY: 40, pointerId: 1 })
        expect(raf).toHaveBeenCalled()
        unmount()
        expect(caf).toHaveBeenCalledWith(42)
      } finally {
        restore()
      }
    })
  })
})
