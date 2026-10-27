import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { PanelLeft } from 'lucide-react'
import { DUR, EASE, useReducedMotion } from '../theme/motion'
import { Sidebar } from './Sidebar'
import './shell.css'

const NARROW = '(max-width: 759px)'
function matches() {
  try {
    return window.matchMedia(NARROW).matches
  } catch {
    return false
  }
}

export function Shell() {
  const [open, setOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => matches())
  const openerRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const reduced = useReducedMotion()

  useEffect(() => {
    try {
      const mq = window.matchMedia(NARROW)
      const on = () => setNarrow(mq.matches)
      mq.addEventListener('change', on)
      return () => mq.removeEventListener('change', on)
    } catch {
      return undefined
    }
  }, [])

  // Move focus into the drawer on open, back to the opener on close.
  useEffect(() => {
    if (open) document.querySelector<HTMLElement>('.sb .sb__new')?.focus()
    else if (wasOpen.current) openerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const t = reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }
  return (
    <div className={`shell${open ? ' shell--open' : ''}`}>
      <Sidebar narrow={narrow} open={open} onNavigate={() => setOpen(false)} />
      <div className="shell__scrim" onClick={() => setOpen(false)} aria-hidden />
      <div className="shell__main">
        <header className="shell__bar">
          <button ref={openerRef} type="button" className="shell__menu" aria-label="Open conversations" aria-expanded={open} onClick={() => setOpen(true)}>
            <PanelLeft size={18} aria-hidden />
          </button>
          <span className="shell__title">dummy-rag</span>
        </header>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname}
            className="shell__page"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={t}
          >
            {outlet ?? <Outlet />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
