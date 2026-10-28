import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCountUp } from './motion'

const flags = vi.hoisted(() => ({ reduced: false }))
vi.mock('motion/react', async (orig) => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => flags.reduced }))
afterEach(() => {
  flags.reduced = false
  vi.useRealTimers()
})

function Count({ value, enabled }: { value: number; enabled: boolean }) {
  return <span data-testid="n">{useCountUp(value, enabled, 400).toFixed(2)}</span>
}

describe('useCountUp', () => {
  it('counts a fresh number up from zero and lands exactly on it', async () => {
    vi.useFakeTimers()
    render(<Count value={0.92} enabled />)
    expect(screen.getByTestId('n')).toHaveTextContent('0.00')
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    const mid = Number(screen.getByTestId('n').textContent)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(0.92)
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(screen.getByTestId('n')).toHaveTextContent('0.92')
  })

  it('shows the value at once when not fresh, or under reduced motion', () => {
    const { rerender } = render(<Count value={0.5} enabled={false} />)
    expect(screen.getByTestId('n')).toHaveTextContent('0.50')
    flags.reduced = true
    rerender(<Count value={0.75} enabled />)
    expect(screen.getByTestId('n')).toHaveTextContent('0.75')
  })
})
