import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { createStore } from '../../store/store'
import { StoreProvider } from '../../store/StoreProvider'
import type { ChatClient } from '../../client/chatClient'
import type { ChatEvent, ChatResponse, TraceStage } from '../../domain/types'
import { ChatView } from './ChatView'

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers() })

function mount(clientFor?: () => ChatClient) {
  const store = createStore(clientFor ? { clientFor } : {})
  const view = render(
    <StoreProvider store={store}>
      <MemoryRouter>
        <ChatView />
      </MemoryRouter>
    </StoreProvider>,
  )
  return { store, ...view }
}
const setup = () => userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
const settle = () => act(async () => { await vi.runAllTimersAsync() })
const box = () => screen.getByRole('textbox', { name: 'Ask a question' })

function fakeResponse(answer: string): ChatResponse {
  return {
    answer, citations: [], facts: [], sources: [], cypher: [], trace: [],
    subgraph: { nodes: [], edges: [] }, confidence: 0.5, resolvedQuestion: null, followUps: [],
    stats: { totalMs: 10, settings: { source: 'offline', mode: 'hybrid', useContext: true, generateAnswer: true } },
  }
}
const fixedClient = (answer: string) => () => ({
  async *chat() { yield { type: 'done' as const, response: fakeResponse(answer) } },
})

async function ask(q: string) {
  const user = setup()
  await user.type(box(), q)
  await user.keyboard('{Enter}')
  await settle()
  return user
}

describe('layout: glass header and floating dock', () => {
  it('the header turns to glass once the conversation scrolls beneath it', async () => {
    const { container } = mount(fixedClient('An answer.'))
    await ask('Who owns Meridian?')
    const head = container.querySelector('.chat__head')!
    const scroller = container.querySelector<HTMLElement>('.chat__scroll')!
    expect(head).not.toHaveClass('is-scrolled')
    scroller.scrollTop = 120
    fireEvent.scroll(scroller)
    expect(head).toHaveClass('is-scrolled')
    scroller.scrollTop = 0
    fireEvent.scroll(scroller)
    expect(head).not.toHaveClass('is-scrolled')
  })

  it('reserves the dock height at the foot of the conversation', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(132)
    const { container } = mount()
    const chat = container.querySelector<HTMLElement>('.chat')!
    expect(chat.style.getPropertyValue('--dock-h')).toBe('132px')
    vi.restoreAllMocks()
  })
})

const stage = (title: string, id: TraceStage['id'] = 'lexical'): ChatEvent => ({ type: 'stage', stage: { id, title, ms: 50, detail: '' } })

/** Streams the given events, then waits until aborted. */
const hangingClient = (events: ChatEvent[], signals: AbortSignal[] = []) => () => ({
  async *chat(_req: unknown, signal: AbortSignal) {
    signals.push(signal)
    for (const e of events) yield e
    await new Promise<void>((res) => signal.addEventListener('abort', () => res()))
  },
})

describe('busy composer, Stop and live progress', () => {
  it('while answering, the composer is busy and Send becomes Stop; Stop ends it with a Stopped tag', async () => {
    const signals: AbortSignal[] = []
    const { container } = mount(hangingClient([{ type: 'token', text: 'Partial answer ' }], signals))
    const user = await ask('Who owns Meridian?')
    const form = container.querySelector('.composer')!
    expect(form).toHaveClass('is-busy')
    expect(form).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Stop answering' }))
    expect(signals[0].aborted).toBe(true)
    expect(form).not.toHaveClass('is-busy')
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByText(/Stopped/)).toHaveTextContent('Stopped — this answer is incomplete')
  })

  it('Escape in the composer stops a streaming answer', async () => {
    const signals: AbortSignal[] = []
    mount(hangingClient([{ type: 'token', text: 'x' }], signals))
    const user = await ask('Who owns Meridian?')
    await user.click(box())
    await user.keyboard('{Escape}')
    expect(signals[0].aborted).toBe(true)
  })

  it('Enter does not send a second question while one is answering', async () => {
    const { store } = mount(hangingClient([]))
    const user = await ask('First question?')
    await user.type(box(), 'Second question?{Enter}')
    expect(store.getState().conversations[0].messages.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(box()).toHaveValue('Second question?')
  })

  it('shows the stage just reached and folds finished stages into ticks', async () => {
    mount(
      hangingClient([
        stage('Resolve conversation context', 'context'),
        stage('Lexical match (full-text index)', 'lexical'),
        stage('Vector match (embedding index)', 'vector'),
      ]),
    )
    await ask('Who owns Meridian?')
    expect(screen.getAllByRole('status').some((s) => s.textContent === 'Vector match (embedding index)…')).toBe(true)
    const ticks = screen.getByRole('list', { name: 'Finished stages' })
    expect(ticks).toHaveTextContent('Resolve conversation context')
    expect(ticks).toHaveTextContent('Lexical match')
    expect(ticks).not.toHaveTextContent('(full-text index)')
  })

  it('the evidence column shows a skeleton while the selected answer is arriving', async () => {
    mount(hangingClient([]))
    await ask('Who owns Meridian?')
    expect(screen.getByRole('status', { name: 'Gathering evidence…' })).toBeInTheDocument()
    expect(screen.queryByText('Ask a question to see its evidence.')).toBeNull()
  })
})
