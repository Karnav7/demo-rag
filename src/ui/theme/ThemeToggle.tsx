import { useCallback, useEffect, useState } from 'react'
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
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <motion.span
        className="theme-toggle__icon"
        animate={{ rotate: dark ? -180 : 0 }}
        transition={reduced ? { duration: 0 } : { duration: DUR.slow, ease: EASE }}
      >
        {dark ? <Moon size={15} aria-hidden /> : <Sun size={15} aria-hidden />}
      </motion.span>
    </button>
  )
}
