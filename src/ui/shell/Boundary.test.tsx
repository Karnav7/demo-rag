import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lazy } from 'react'
import { LazyView } from './Boundary'

// A chunk that fails to load: the dynamic import of the Guide page rejects.
vi.mock('../pages/Guide', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {}) // React reports the caught error
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('LazyView', () => {
  it('shows a quiet loading note, then the view', async () => {
    let resolve!: (m: { default: () => React.ReactNode }) => void
    const View = lazy(() => new Promise<{ default: () => React.ReactNode }>((r) => (resolve = r)))
    render(<LazyView label="Loading graph…"><View /></LazyView>)
    expect(screen.getByRole('status')).toHaveTextContent('Loading graph…')
    resolve({ default: () => <p>graph</p> })
    expect(await screen.findByText('graph')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a rejected chunk shows a calm note whose Reload reloads the page; siblings stay mounted', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const Broken = lazy(() => Promise.reject(new Error('chunk gone')))
    render(
      <div>
        <nav>sidebar</nav>
        <LazyView label="Loading…"><Broken /></LazyView>
      </div>,
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load this view.')
    expect(screen.getByText('sidebar')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('App routes', () => {
  it('a page chunk that fails to load leaves the sidebar mounted and the chat reachable', async () => {
    window.location.hash = '#/guide'
    const { default: App } = await import('../../App')
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load this view.')
    expect(screen.getByRole('button', { name: /New conversation/ })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /New conversation/ }))
    expect(await screen.findByRole('group', { name: 'Suggested questions' })).toBeInTheDocument()
  })

  it('a failed page does not stick: navigating on to another lazy page renders it', async () => {
    window.location.hash = '#/guide'
    const { default: App } = await import('../../App')
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load this view.')
    await userEvent.setup().click(screen.getByRole('link', { name: 'Architecture' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Hybrid Graph-RAG, end to end' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
