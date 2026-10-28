import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { createStore } from '../../store/store'
import { StoreProvider } from '../../store/StoreProvider'
import type { ChatClient } from '../../client/chatClient'
import type { ChatResponse } from '../../domain/types'
import { MERIDIAN_NAME, UBO_NAME } from '../../data/scenarios'
import { ChatView } from './ChatView'
import { Markdown } from './Markdown'
import { loadWorld } from '../../data/load'

// shouldAdvanceTime: RTL's async wrapper waits on a real setTimeout(0) that a frozen clock never fires.
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

function mount(clientFor?: () => ChatClient) {
  const store = createStore(clientFor ? { clientFor } : {})
  render(
    <StoreProvider store={store}>
      <MemoryRouter>
        <ChatView />
      </MemoryRouter>
    </StoreProvider>,
  )
  return store
}
const setup = () => userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
const settle = () => act(async () => { await vi.runAllTimersAsync() })
const box = () => screen.getByRole('textbox', { name: 'Ask a question' })
const answers = () => screen.queryAllByRole('article', { name: 'Answer' })

async function ask(q: string) {
  const user = setup()
  await user.type(box(), q)
  await user.keyboard('{Enter}')
  await settle()
  return user
}

function fakeResponse(answer: string): ChatResponse {
  return {
    answer, citations: [{ n: 1, section_id: 'sec-1' }], facts: [], sources: [], cypher: [], trace: [],
    subgraph: { nodes: [], edges: [] }, confidence: 0.5, resolvedQuestion: null, followUps: [],
    stats: { totalMs: 10, settings: { source: 'offline', mode: 'hybrid', useContext: true, generateAnswer: true } },
  }
}
const fixedClient = (answer: string) => () => ({
  async *chat() { yield { type: 'done' as const, response: fakeResponse(answer) } },
})

describe('Chat', () => {
  it('whitespace does not send', async () => {
    const store = mount()
    const user = setup()
    await user.type(box(), '   ')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(store.getState().conversations).toEqual([])
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('Shift+Enter inserts newline', async () => {
    const store = mount()
    const user = setup()
    await user.type(box(), 'a{Shift>}{Enter}{/Shift}b')
    expect(box()).toHaveValue('a\nb')
    expect(store.getState().conversations).toEqual([])
  })

  it('asking a suggested chip produces an answer with citations and follow-ups', async () => {
    mount()
    expect(screen.getByRole('heading', { name: 'What do you want to trace?' })).toBeInTheDocument()
    expect(screen.getByText(/Fictional data for demonstration\. Not financial or legal advice\./)).toBeInTheDocument()
    const chips = within(screen.getByRole('group', { name: 'Suggested questions' })).getAllByRole('button')
    expect(chips).toHaveLength(4)
    const user = setup()
    await user.click(screen.getByRole('button', { name: `Who ultimately owns ${MERIDIAN_NAME}?` }))
    await settle()
    const [a] = answers()
    expect(a).toHaveTextContent(UBO_NAME)
    expect(a.querySelectorAll('button.cite').length).toBeGreaterThan(0)
    expect(within(a).getByRole('meter', { name: 'Grounding confidence' })).toBeInTheDocument()
    const follow = within(a).getByRole('group', { name: 'Suggested follow-ups' })
    expect(within(follow).getAllByRole('button').length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: 'What do you want to trace?' })).not.toBeInTheDocument()
  })

  it('no-entity question renders "No matching facts in the graph."', async () => {
    mount()
    await ask('What is the weather like on Mars today?')
    expect(answers()[0]).toHaveTextContent('No matching facts in the graph.')
  })

  it('copy writes markdown to clipboard', async () => {
    const store = mount()
    const user = await ask(`Who ultimately owns ${MERIDIAN_NAME}?`)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await user.click(within(answers()[0]).getByRole('button', { name: 'Copy answer' }))
    const md = store.getState().conversations[0].messages[1].response!.answer
    expect(md).toMatch(/\[\d+\]/)
    expect(writeText).toHaveBeenCalledWith(md)
    expect(await within(answers()[0]).findByText('Copied')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(within(answers()[0]).queryByText('Copied')).not.toBeInTheDocument()
  })

  it('regenerate keeps message count', async () => {
    const store = mount()
    const user = await ask(`Who ultimately owns ${MERIDIAN_NAME}?`)
    expect(screen.getAllByRole('article')).toHaveLength(2)
    await user.click(within(answers()[0]).getByRole('button', { name: 'Regenerate' }))
    await settle()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(store.getState().conversations[0].messages).toHaveLength(2)
    expect(answers()[0]).toHaveTextContent(UBO_NAME)
  })

  it('markdown is sanitised', async () => {
    mount(fixedClient('Hello <img src="x" onerror="alert(1)"> world [1]'))
    await ask('anything')
    const a = answers()[0]
    const img = a.querySelector('img')
    if (img) expect(img).not.toHaveAttribute('onerror')
    expect(a.innerHTML).not.toContain('onerror')
    expect(a.querySelector('button.cite[data-n="1"]')).toBeInTheDocument()
  })

  it('live shows (simulated) label when no VITE_CHAT_URL', async () => {
    vi.stubEnv('VITE_CHAT_URL', '')
    const store = mount()
    const user = setup()
    const trigger = screen.getByRole('button', { name: /Data source/ })
    await user.click(trigger)
    const live = screen.getByRole('option', { name: /Live Neo4j \(simulated\)/ })
    expect(live).toHaveFocus()
    expect(screen.getByRole('option', { name: /Offline snapshot/ })).toHaveTextContent('Exported from the graph')
    await user.click(live)
    expect(store.getState().settings.source).toBe('live')
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveTextContent('Live Neo4j (simulated)')
  })

  it('retrieval mode popover closes on Escape and returns focus', async () => {
    const store = mount()
    const user = setup()
    const trigger = screen.getByRole('button', { name: /Retrieval mode/ })
    await user.click(trigger)
    expect(screen.getByRole('option', { name: /Graph/ })).toHaveTextContent('3-hop traversal from the fused seeds')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: /^Lexical/ }))
    expect(store.getState().settings.mode).toBe('lexical')
  })

  it('context and LLM toggles flip settings', async () => {
    const store = mount()
    const user = setup()
    const ctx = screen.getByRole('switch', { name: 'Use conversation context to resolve follow-ups' })
    const llm = screen.getByRole('switch', { name: 'Generate an LLM answer (off = extractive facts only)' })
    expect(ctx).toHaveAttribute('aria-checked', 'true')
    await user.click(ctx)
    await user.click(llm)
    expect(store.getState().settings).toMatchObject({ useContext: false, generateAnswer: false })
  })

  it('pending message shows the stage line', async () => {
    mount()
    const user = setup()
    await user.type(box(), `Who ultimately owns ${MERIDIAN_NAME}?{Enter}`)
    expect(screen.getByText('Hybrid retrieval · reading snapshot…')).toBeInTheDocument()
    await settle()
    expect(screen.queryByText('Hybrid retrieval · reading snapshot…')).not.toBeInTheDocument()
  })

  it('a citation shows its section and document on hover', () => {
    const w = loadWorld()
    const sec = w.sections[0]
    const doc = w.documents.find((d) => d.id === sec.document_id)!
    const { container } = render(<Markdown text="Owned by Alpha [1]." citations={[{ n: 1, section_id: sec.id }]} />)
    const cite = container.querySelector<HTMLButtonElement>('button.cite[data-n="1"]')!
    expect(cite).toHaveAttribute('title', `[1] ${sec.title}, ${doc.title}`)
    expect(cite).toHaveAccessibleName('Source 1')
  })

  it('clicking a cite selects the message and highlights its section', async () => {
    const store = mount()
    const user = await ask(`Who ultimately owns ${MERIDIAN_NAME}?`)
    const msg = store.getState().conversations[0].messages[1]
    const cite = answers()[0].querySelector<HTMLButtonElement>('button.cite')!
    await user.click(cite)
    const n = Number(cite.dataset.n)
    expect(store.getState().highlight).toEqual({
      messageId: msg.id,
      sectionId: msg.response!.citations.find((c) => c.n === n)!.section_id,
    })
    expect(store.getState().selectedMessageId).toBe(msg.id)
  })

  it('conversation menu clears messages but keeps the thread', async () => {
    const store = mount()
    const user = await ask(`Who ultimately owns ${MERIDIAN_NAME}?`)
    await user.click(screen.getByRole('button', { name: 'Conversation options' }))
    expect(screen.getByRole('menuitem', { name: /Export conversation/ })).toHaveFocus()
    await user.click(screen.getByRole('menuitem', { name: /Clear conversation/ }))
    expect(store.getState().conversations).toHaveLength(1)
    expect(store.getState().conversations[0].messages).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'What do you want to trace?' })).toBeInTheDocument()
  })

  it('renders the evidence column placeholder', () => {
    mount()
    expect(screen.getByRole('complementary', { name: 'Evidence' })).toHaveTextContent('Ask a question to see its evidence.')
  })
})
