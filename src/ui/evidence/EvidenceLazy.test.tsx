import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChatResponse } from '../../domain/types'
import { EvidencePanel } from './EvidencePanel'

// The graph views' chunk fails to load.
vi.mock('../graph/GraphViews', () => {
  throw new Error('Failed to fetch dynamically imported module')
})
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

const r: ChatResponse = {
  answer: 'Alpha owns Beta [1].',
  citations: [{ n: 1, section_id: 'sec-1' }],
  facts: [{ rel_id: 'r1', subject: 'Alpha Ltd', relation: 'OWNS', object: 'Beta LLC', confidence: 0.9, section_id: 'sec-1', used: true }],
  sources: [{ id: 'sec-1', document_id: 'doc-x', title: 'First passage', text: 'Alpha text.' }],
  cypher: [], trace: [],
  subgraph: { nodes: [{ id: 'n1', label: 'Company', name: 'Alpha Ltd', props: {}, used: true, seed: true }], edges: [] },
  confidence: 0.8, resolvedQuestion: null, followUps: [],
  stats: { totalMs: 10, settings: { source: 'offline', mode: 'hybrid', useContext: true, generateAnswer: true } },
}

it('a graph chunk that fails to load shows a calm note and keeps the tabs working', async () => {
  render(<EvidencePanel response={r} tab="graph" onTab={() => {}} />)
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Couldn’t load this view.')
  expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Facts' })).toBeInTheDocument()
})
