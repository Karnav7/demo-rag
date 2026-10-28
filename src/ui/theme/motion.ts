import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

export { useReducedMotion }

export const EASE = [0.2, 0.8, 0.2, 1] as const
export const DUR = { fast: 0.2, base: 0.35, slow: 0.55, theme: 0.5 }

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Counts from 0 up to `value` over `ms` when `enabled` (a freshly arrived number), else returns `value` as is.
 * Reduced motion, a non-finite value, or a value that changes mid-count settle immediately on the target.
 */
export function useCountUp(value: number, enabled: boolean, ms = 400): number {
  const reduced = useReducedMotion()
  const animate = enabled && !reduced && Number.isFinite(value) && typeof requestAnimationFrame === 'function'
  const [shown, setShown] = useState(animate ? 0 : value)
  const raf = useRef(0)
  useEffect(() => {
    if (!animate) {
      setShown(value)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      setShown(value * easeOut(t))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value, animate, ms])
  return shown
}
