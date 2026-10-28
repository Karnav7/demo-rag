import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { createStore } from '../../store/store'
import { StoreProvider } from '../../store/StoreProvider'
import type { ChatClient } from '../../client/chatClient'
import type { ChatResponse } from '../../domain/types'
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
