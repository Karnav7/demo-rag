import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import { createStore } from '../../store/store'
import { StoreProvider } from '../../store/StoreProvider'
import type { ChatClient } from '../../client/chatClient'
import type { ChatResponse } from '../../domain/types'
import { ChatView } from '../chat/ChatView'
import { EvidencePanel, type EvidenceTab } from './EvidencePanel'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

// Panel tests run on real timers (motion's frame loop does not survive a clock swap between tests);
// the chat-driven tests below use the same fake-clock setup as Chat.test.tsx.
const setup = () => userEvent.setup()
const fake = () => vi.useFakeTimers({ shouldAdvanceTime: true })
const fakeSetup = () => userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
const settle = () => act(async () => { await vi.runAllTimersAsync() })

const settings = { source: 'offline', mode: 'hybrid', useContext: true, generateAnswer: true } as const
function response(over: Partial<ChatResponse> = {}): ChatResponse {
  return {
    answer: 'Alpha owns Beta [1].',
    citations: [{ n: 1, section_id: 'sec-2' }],
    facts: [
      { rel_id: 'r1', subject: 'Alpha Ltd', relation: 'OWNS', object: 'Beta LLC', confidence: 0.91, section_id: 'sec-1', used: true },
      { rel_id: 'r2', subject: 'Gamma Inc', relation: 'DIRECTOR_OF', object: 'Delta Co', confidence: 0.42, section_id: null, used: false },
    ],
    sources: [
      { id: 'sec-1', document_id: 'doc-x', title: 'First passage', text: 'Alpha text.' },
      { id: 'sec-2', document_id: 'doc-x', title: 'Second passage', text: 'Beta text.' },
    ],
    cypher: [
      { stage: 'lexical', query: 'MATCH (n) RETURN n', explain: 'Find names.' },
      { stage: 'expand', query: 'MATCH (a)-[r]->(b) RETURN r', explain: 'Walk the graph.' },
    ],
    trace: [
      { id: 'lexical', title: 'Lexical search', ms: 12, detail: 'two hits' },
      { id: 'expand', title: 'Expand', ms: 48, detail: 'three hops' },
    ],
    subgraph: { nodes: [], edges: [] }, confidence: 0.7, resolvedQuestion: null, followUps: [],
    stats: { totalMs: 60, settings },
    ...over,
  }
}

function Harness({ r, initial = 'facts', highlight }: { r: ChatResponse | null; initial?: EvidenceTab; highlight?: string }) {
  const [tab, setTab] = useState<EvidenceTab>(initial)
  return <EvidencePanel response={r} tab={tab} onTab={setTab} highlightSectionId={highlight} />
}

describe('Evidence', () => {
  it('facts filter shows "No facts match."', async () => {
    render(<Harness r={response()} />)
    const user = setup()
    await user.type(screen.getByRole('searchbox', { name: 'Filter facts' }), 'zzz')
    expect(screen.getByText('No facts match.')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox', { name: 'Filter facts' }))
    await user.type(screen.getByRole('searchbox', { name: 'Filter facts' }), 'gamma')
    expect(screen.getByText('Gamma Inc')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Ltd')).toBeNull()
  })

  it('used-only toggle hides unused facts', async () => {
    render(<Harness r={response()} />)
    const user = setup()
    expect(screen.getByText('Gamma Inc')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Only facts used in the answer' }))
    expect(screen.queryByText('Gamma Inc')).toBeNull()
    expect(screen.getByText('Alpha Ltd')).toBeInTheDocument()
  })

  it('sorts facts by confidence', async () => {
    render(<Harness r={response()} />)
    const user = setup()
    await user.click(screen.getByRole('button', { name: /Sort by confidence/ }))
    const rows = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)
    expect(rows()).toEqual(['Alpha Ltd', 'Gamma Inc'])
    await user.click(screen.getByRole('button', { name: /Sort by confidence/ }))
    expect(rows()).toEqual(['Gamma Inc', 'Alpha Ltd'])
  })

  it('marks the highlighted source section', () => {
    render(<Harness r={response()} initial="sources" highlight="sec-2" />)
    const cur = document.querySelectorAll('[aria-current="true"]')
    expect(cur).toHaveLength(1)
    expect(cur[0]).toHaveTextContent('Second passage')
  })

  it('cypher shows one block per executed stage', () => {
    render(<Harness r={response()} initial="cypher" />)
    const list = screen.getByRole('list', { name: 'Cypher steps' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('MATCH (n) RETURN n')).toBeInTheDocument()
    expect(within(list).getAllByRole('button', { name: /Copy/ })).toHaveLength(2)
  })

  it('trace total equals stats.totalMs', () => {
    render(<Harness r={response({ stats: { totalMs: 77, settings } })} initial="trace" />)
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('77 ms')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('empty response renders empty states without throwing', async () => {
    const empty = response({ facts: [], sources: [], cypher: [], trace: [], citations: [] })
    render(<Harness r={empty} initial="facts" />)
    const user = setup()
    expect(screen.getByText('No facts for this answer.')).toBeInTheDocument()
    const empties: [string, string][] = [
      ['Sources', 'No sources for this answer.'],
      ['Cypher', 'No Cypher was run for this answer.'],
      ['Trace', 'No trace for this answer.'],
      ['Subgraph', 'No graph for this answer.'],
    ]
    for (const [name, text] of empties) {
      await user.click(screen.getByRole('tab', { name }))
      expect(await screen.findByText(text)).toBeInTheDocument()
    }
  })

  it('with no response reads "Ask a question to see its evidence."', () => {
    render(<Harness r={null} />)
    expect(screen.getByText('Ask a question to see its evidence.')).toBeInTheDocument()
  })

  it('help popover explains the active tab and closes on Escape', async () => {
    render(<Harness r={response()} />)
    const user = setup()
    const help = screen.getByRole('button', { name: 'What is this tab?' })
    await user.click(help)
    expect(help).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('note')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('note')).toBeNull()
    expect(help).toHaveFocus()
  })

  it('arrow keys move between tabs', async () => {
    render(<Harness r={response()} />)
    const user = setup()
    screen.getByRole('tab', { name: 'Facts' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Evidence from the chat', () => {
  it('citation click switches to Sources and marks the section', async () => {
    fake()
    const clientFor = (): ChatClient => ({
      async *chat() { yield { type: 'done' as const, response: response() } },
    })
    render(
      <StoreProvider store={createStore({ clientFor })}>
        <MemoryRouter><ChatView /></MemoryRouter>
      </StoreProvider>,
    )
    const user = fakeSetup()
    await user.type(screen.getByRole('textbox', { name: 'Ask a question' }), 'who owns beta')
    await user.keyboard('{Enter}')
    await settle()
    await user.click(await screen.findByRole('button', { name: 'Source 1' }))
    await settle()
    expect(screen.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true')
    const cur = await screen.findByText('Second passage')
    expect(cur.closest('[aria-current="true"]')).not.toBeNull()
  })
})

describe('Evidence drawer (narrow)', () => {
  function narrow() {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('1099'), media: q, addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
    }))
  }
  async function mountAsked() {
    fake()
    narrow()
    const clientFor = (): ChatClient => ({
      async *chat() { yield { type: 'done' as const, response: response() } },
    })
    render(
      <StoreProvider store={createStore({ clientFor })}>
        <MemoryRouter><ChatView /></MemoryRouter>
      </StoreProvider>,
    )
    const user = fakeSetup()
    await user.type(screen.getByRole('textbox', { name: 'Ask a question' }), 'who owns beta')
    await user.keyboard('{Enter}')
    await settle()
    return user
  }

  it('is inert when closed; opens as a dialog, focuses in, and Escape returns focus', async () => {
    const user = await mountAsked()
    const opener = screen.getByRole('button', { name: 'Show evidence', expanded: false })
    expect(document.querySelector('aside.evidence')).toHaveAttribute('inert')
    await user.click(opener)
    const dlg = screen.getByRole('dialog', { name: 'Evidence' })
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).not.toHaveAttribute('inert')
    expect(dlg.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    expect(document.querySelector('aside.evidence')).toHaveAttribute('inert')
    expect(opener).toHaveFocus()
  })

  it('the message "Show evidence" action opens the drawer', async () => {
    const user = await mountAsked()
    const msg = screen.getByRole('article', { name: 'Answer' })
    await user.click(within(msg).getByRole('button', { name: 'Show evidence' }))
    expect(screen.getByRole('dialog', { name: 'Evidence' })).toBeInTheDocument()
  })

  it('a citation click opens the drawer on the Sources tab', async () => {
    const user = await mountAsked()
    await user.click(await screen.findByRole('button', { name: 'Source 1' }))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Evidence' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true')
  })
})
