import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Fact, Subgraph, TraceStage } from '../../domain/types'
import { Markdown } from '../chat/Markdown'
import { FactsTable } from '../evidence/FactsTable'
import { TraceSteps } from '../evidence/TraceSteps'
import { Force } from '../graph/Force'

const fact = (id: string, confidence: number): Fact => ({
  rel_id: id, subject: `S${id}`, relation: 'OWNS', object: `O${id}`, confidence, section_id: null, used: true,
})

describe('data-driven colour', () => {
  it('Facts tint each confidence on the ramp', () => {
    render(<FactsTable facts={[fact('a', 0.95), fact('b', 0.55)]} />)
    const strong = screen.getByText('0.95').closest('.facts__conf') as HTMLElement
    const weak = screen.getByText('0.55').closest('.facts__conf') as HTMLElement
    expect(strong.style.getPropertyValue('--c')).toBe('var(--conf-5)')
    expect(weak.style.getPropertyValue('--c')).toBe('var(--conf-2)')
  })

  it('Trace bars heat with their share of the slowest stage', () => {
    const trace: TraceStage[] = [
      { id: 'lexical', title: 'Lexical', ms: 100, detail: '' },
      { id: 'expand', title: 'Expand', ms: 200, detail: '' },
    ]
    const { container } = render(<TraceSteps trace={trace} totalMs={300} />)
    const fills = [...container.querySelectorAll<HTMLElement>('.trace__fill')].map((f) => f.style.background)
    expect(fills[0]).toContain('50%')
    expect(fills[1]).toContain('100%')
  })

  it('citation chips carry their strongest fact confidence', () => {
    render(
      <Markdown
        text="Owned by Ada [1] via Bly [2]."
        citations={[{ n: 1, section_id: 's1' }, { n: 2, section_id: 's2' }]}
        citeConfidence={new Map([[1, 0.92], [2, 0.6]])}
      />,
    )
    expect(screen.getByRole('button', { name: 'Source 1' }).style.getPropertyValue('--cite')).toBe('var(--conf-5)')
    expect(screen.getByRole('button', { name: 'Source 2' }).style.getPropertyValue('--cite')).toBe('var(--conf-2)')
  })

  it('graph: sanctions matches follow match strength, used edges follow confidence, risk nodes are marked', () => {
    const g: Subgraph = {
      nodes: [
        { id: 'p', label: 'Person', name: 'Ada', props: {}, used: true, seed: true },
        { id: 's', label: 'SanctionsEntry', name: 'ADA LISTED', props: {}, used: true, seed: false },
        { id: 'c', label: 'Company', name: 'Bly', props: {}, used: true, seed: false },
      ],
      edges: [
        { id: 'm', type: 'MATCHES', from: 'p', to: 's', confidence: 0.95, section_id: null, props: { score: 0.91 }, used: true },
        { id: 'o', type: 'OWNS', from: 'p', to: 'c', confidence: 0.7, section_id: null, props: {}, used: true },
      ],
    }
    const { container } = render(<Force subgraph={g} dim={false} onNodeOpen={() => {}} />)
    const stroke = (id: string) => container.querySelector<SVGElement>(`[data-edge="${id}"]`)!.style.stroke
    expect(stroke('m')).toBe('var(--risk-3)')
    expect(stroke('o')).toBe('var(--conf-3)')
    expect(container.querySelector('.g-risk--3 .g-halo')).not.toBeNull()
  })
})
