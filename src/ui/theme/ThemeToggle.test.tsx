import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ThemeToggle } from './ThemeToggle'
import { setPrefersDark } from '../../test/setup'

const motionPref = vi.hoisted(() => ({ reduced: false }))
vi.mock('./motion', async (importOriginal) => ({ ...(await importOriginal<typeof import('./motion')>()), useReducedMotion: () => motionPref.reduced }))
afterEach(() => { motionPref.reduced = false })

const icon = () => document.querySelector<HTMLElement>('.theme-toggle__icon')!
/** The icon's rotation in degrees, read from its inline transform (none = 0). */
/** Longer than the icon's animation (DUR.slow), so what is read is the resting state. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 800)))
const rotation = () => Number(/rotate\((-?[\d.]+)deg\)/.exec(icon().style.transform)?.[1] ?? 0)

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

  it('the icon rests upright in both themes', async () => {
    render(<ThemeToggle />)
    await settle()
    expect(rotation()).toBe(0)
    await userEvent.click(screen.getByRole('button'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    await settle()
    expect(rotation()).toBe(0)
    await userEvent.click(screen.getByRole('button'))
    await settle()
    expect(rotation()).toBe(0)
  })

  it('starts upright when the page loads in dark', async () => {
    setPrefersDark(true)
    render(<ThemeToggle />)
    await settle()
    expect(rotation()).toBe(0)
  })

  it('does not rotate with reduced motion', async () => {
    motionPref.reduced = true
    render(<ThemeToggle />)
    await userEvent.click(screen.getByRole('button'))
    // Sampled at once and after settling: no frame of the switch is rotated.
    expect(rotation()).toBe(0)
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(rotation()).toBe(0)
    await settle()
    expect(rotation()).toBe(0)
  })
})
