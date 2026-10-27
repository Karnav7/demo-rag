import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ThemeToggle } from './ThemeToggle'
import { setPrefersDark } from '../../test/setup'

describe('ThemeToggle', () => {
  it('toggles data-theme and persists', async () => {
    render(<ThemeToggle />)
    const root = document.documentElement
    expect(root.dataset.theme).toBe('light')
    await userEvent.click(screen.getByRole('button'))
    expect(root.dataset.theme).toBe('dark')
    expect(localStorage.getItem('dummy-rag.theme')).toBe('dark')
    await userEvent.click(screen.getByRole('button'))
    expect(root.dataset.theme).toBe('light')
    expect(localStorage.getItem('dummy-rag.theme')).toBe('light')
  })

  it('falls back when localStorage throws', async () => {
    setPrefersDark(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => render(<ThemeToggle />)).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
    await userEvent.click(screen.getByRole('button'))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('uses the stored theme over system preference', () => {
    setPrefersDark(true)
    localStorage.setItem('dummy-rag.theme', 'light')
    render(<ThemeToggle />)
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
