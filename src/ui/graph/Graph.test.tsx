import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Subgraph, TraceStage } from '../../domain/types'
import { GraphViews } from './GraphViews'
import { colorFor, firstCitedSection } from './graphStyle'

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

  it('replay steps through hits, seeds, expansion and used facts', async () => {
    localStorage.setItem(KEY, 'replay')
    render(<GraphViews subgraph={subgraph} trace={trace} onNodeOpen={() => {}} />)
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Play|Pause/ })).toBeInTheDocument()
    expect(await screen.findByText(/Used facts/, {}, { timeout: 5000 })).toBeInTheDocument()
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
})
