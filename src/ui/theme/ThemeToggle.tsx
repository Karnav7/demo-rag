import { useCallback, useEffect, useRef, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { DUR, EASE, useReducedMotion } from './motion'
import { motion } from 'motion/react'

export type Theme = 'light' | 'dark'
const KEY = 'dummy-rag.theme'

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // storage unavailable; fall through to system preference
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function useTheme(): { theme: Theme; toggle(): void } {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = useCallback(() => {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // ignore persistence failures
    }
  }, [theme])

  return { theme, toggle }
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const reduced = useReducedMotion()
  const dark = theme === 'dark'
  // The icon is keyed by theme, so each switch mounts the new glyph and turns it in to upright. Nothing turns on
  // first paint, and nothing at all with reduced motion.
  const switched = useRef(false)
  useEffect(() => {
    switched.current = true
  }, [])
  const enter = reduced || !switched.current ? false : { rotate: -90, opacity: 0 }
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <motion.span
        key={theme}
        className="theme-toggle__icon"
        initial={enter}
        animate={{ rotate: 0, opacity: 1 }}
        transition={reduced ? { duration: 0 } : { duration: DUR.slow, ease: EASE }}
      >
        {dark ? <Moon size={15} aria-hidden /> : <Sun size={15} aria-hidden />}
      </motion.span>
    </button>
  )
}
