import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createStore, type AppStore } from '../../store/store'
import { StoreProvider } from '../../store/StoreProvider'
import { Sidebar } from './Sidebar'
import { loadWorld } from '../../data/load'

const DAY = 86_400_000

function seed(items: { id: string; title: string; ago: number }[]) {
  const now = Date.now()
  localStorage.setItem(
    'dummy-rag.conversations',
    JSON.stringify(items.map((i) => ({ id: i.id, title: i.title, createdAt: now - i.ago, updatedAt: now - i.ago, messages: [] }))),
  )
}

function setup(items: { id: string; title: string; ago: number }[]): AppStore {
  seed(items)
  const store = createStore()
  render(
    <StoreProvider store={store}>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </StoreProvider>,
  )
  return store
}

const three = [
  { id: 'a', title: 'Shell company payments', ago: 1000 },
  { id: 'b', title: 'Mule account ring', ago: 2000 },
  { id: 'c', title: 'Sanctions screening', ago: 3000 },
]

describe('Sidebar', () => {
  it('one active marker follows the selected conversation', async () => {
    const store = setup(three)
    await act(async () => store.getState().select('b'))
    const marker = () => document.querySelectorAll('.conv__ink')
    expect(marker()).toHaveLength(1)
    expect(marker()[0].closest('li')).toHaveTextContent('Mule account ring')
    await act(async () => store.getState().select('c'))
    expect(marker()).toHaveLength(1)
    expect(marker()[0].closest('li')).toHaveTextContent('Sanctions screening')
  })

  it('the Architecture link tells the size of the graph on hover', () => {
    setup([])
    const w = loadWorld()
    expect(screen.getByRole('link', { name: 'Architecture' })).toHaveAttribute(
      'title',
      `${w.nodes.length} nodes · ${w.rels.length} relationships`,
    )
  })

  it('search filters list', async () => {
    setup(three)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    await userEvent.type(screen.getByRole('searchbox', { name: /search conversations/i }), 'mule')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Mule account ring')).toBeInTheDocument()
    expect(screen.queryByText('Sanctions screening')).not.toBeInTheDocument()
  })

  it('rename via menu', async () => {
    const store = setup(three)
    await userEvent.click(screen.getByRole('button', { name: /options for Mule account ring/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: /rename conversation/i })
    await userEvent.clear(input)
    await userEvent.type(input, 'Renamed one{Enter}')
    expect(screen.getByText('Renamed one')).toBeInTheDocument()
    expect(store.getState().conversations.find((c) => c.id === 'b')?.title).toBe('Renamed one')
  })

  it('rename Escape cancels', async () => {
    const store = setup(three)
    await userEvent.click(screen.getByRole('button', { name: /options for Mule account ring/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await userEvent.type(screen.getByRole('textbox', { name: /rename conversation/i }), 'zzz{Escape}')
    expect(screen.getByText('Mule account ring')).toBeInTheDocument()
    expect(store.getState().conversations.find((c) => c.id === 'b')?.title).toBe('Mule account ring')
  })

  it('delete requires confirm', async () => {
    const store = setup(three)
    await userEvent.click(screen.getByRole('button', { name: /options for Mule account ring/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(store.getState().conversations).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: 'Delete? Yes' }))
    expect(store.getState().conversations).toHaveLength(2)
    expect(screen.queryByText('Mule account ring')).not.toBeInTheDocument()
  })

  it('Escape closes menu', async () => {
    setup(three)
    await userEvent.click(screen.getByRole('button', { name: /options for Mule account ring/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('menu open focuses first item, arrows move, focus returns after rename', async () => {
    setup(three)
    const more = screen.getByRole('button', { name: /options for Mule account ring/i })
    await userEvent.click(more)
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('x{Enter}')
    expect(screen.getByRole('button', { name: /options for x$/i })).toHaveFocus()
  })

  it('Escape in confirm mode closes it and refocuses the menu button', async () => {
    const store = setup(three)
    await userEvent.click(screen.getByRole('button', { name: /options for Mule account ring/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'Delete? Yes' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Delete? Yes' })).not.toBeInTheDocument()
    expect(store.getState().conversations).toHaveLength(3)
    expect(screen.getByRole('button', { name: /options for Mule account ring/i })).toHaveFocus()
  })

  it('groups render headings in order Today, Yesterday, Previous 7 days, Older', () => {
    setup([
      { id: 'o', title: 'Old one', ago: 30 * DAY },
      { id: 'w', title: 'Week one', ago: 4 * DAY },
      { id: 'y', title: 'Yday one', ago: DAY + 1000 },
      { id: 't', title: 'Today one', ago: 1000 },
    ])
    const heads = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    // Today may roll to Yesterday only at midnight; assert order of whichever exist.
    const order = ['Today', 'Yesterday', 'Previous 7 days', 'Older']
    expect(heads.length).toBeGreaterThanOrEqual(3)
    expect(heads).toEqual(order.filter((o) => heads.includes(o)))
    expect(heads[heads.length - 1]).toBe('Older')
    expect(within(screen.getByRole('navigation', { name: /conversations/i })).getAllByRole('listitem')).toHaveLength(4)
  })

  it('footer has Guide, Architecture and the theme toggle', () => {
    setup([])
    expect(screen.getByRole('link', { name: /guide/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /architecture/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /switch to dark theme/i })).toBeInTheDocument()
  })
})
