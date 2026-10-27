import { useEffect, useState } from 'react'
import { Outlet, useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { PanelLeft } from 'lucide-react'
import { DUR, EASE, useReducedMotion } from '../theme/motion'
import { Sidebar } from './Sidebar'
import './shell.css'

export function Shell() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const t = reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }
  return (
    <div className={`shell${open ? ' shell--open' : ''}`}>
      <Sidebar onNavigate={() => setOpen(false)} />
      <div className="shell__scrim" onClick={() => setOpen(false)} aria-hidden />
      <div className="shell__main">
        <header className="shell__bar">
          <button type="button" className="shell__menu" aria-label="Open conversations" onClick={() => setOpen(true)}>
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
