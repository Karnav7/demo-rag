import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createStore } from '../../store/store'
import { StoreProvider } from '../../store/StoreProvider'
import { Shell } from './Shell'

function mount(narrow: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width') ? narrow : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {},
  }))
  render(
    <StoreProvider store={createStore()}>
      <MemoryRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<p>page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </StoreProvider>,
  )
}

describe('Shell drawer', () => {
  it('closed drawer is inert and opener reports aria-expanded', () => {
    mount(true)
    const opener = screen.getByRole('button', { name: 'Open conversations' })
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('aside.sb')).toHaveAttribute('inert')
  })

  it('opens with focus inside, Escape closes and returns focus to opener', async () => {
    mount(true)
    const opener = screen.getByRole('button', { name: 'Open conversations' })
    await userEvent.click(opener)
    expect(opener).toHaveAttribute('aria-expanded', 'true')
    const dialog = screen.getByRole('dialog', { name: /conversations/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).not.toHaveAttribute('inert')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await userEvent.keyboard('{Escape}')
    expect(opener).toHaveFocus()
    expect(document.querySelector('aside.sb')).toHaveAttribute('inert')
  })

  it('scrim click closes and returns focus', async () => {
    mount(true)
    const opener = screen.getByRole('button', { name: 'Open conversations' })
    await userEvent.click(opener)
    await userEvent.click(document.querySelector('.shell__scrim')!)
    expect(opener).toHaveFocus()
  })

  it('wide layout is never inert', () => {
    mount(false)
    expect(document.querySelector('aside.sb')).not.toHaveAttribute('inert')
  })
})
