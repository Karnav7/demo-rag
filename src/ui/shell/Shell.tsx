import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { PanelLeft } from 'lucide-react'
import { DUR, EASE, useReducedMotion } from '../theme/motion'
import { useDrawer } from './useDrawer'
import { Sidebar } from './Sidebar'
import { useAppStore } from '../../store/StoreProvider'
import { COMPOSER_INPUT_ID } from '../chat/Composer'
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
  const [narrow, setNarrow] = useState(() => matches())
  const { shown: open, show, hide, openerRef } = useDrawer({
    enabled: narrow,
    focusSelector: '.sb .sb__new',
    background: () => [...document.querySelectorAll('.shell__main')],
  })
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const reduced = useReducedMotion()
  const { newConversation } = useAppStore()
  const navigate = useNavigate()

  // Ctrl/⌘+K: a fresh conversation from anywhere, with the cursor in the question box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      newConversation()
      navigate('/')
      hide()
      requestAnimationFrame(() => document.getElementById(COMPOSER_INPUT_ID)?.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newConversation, navigate, hide])

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

  const t = reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }
  return (
    <div className={`shell${open ? ' shell--open' : ''}`}>
      <Sidebar narrow={narrow} open={open} onNavigate={() => hide()} />
      <div className="shell__scrim" onClick={() => hide()} aria-hidden />
      <div className="shell__main">
        <header className="shell__bar">
          <button ref={openerRef} type="button" className="shell__menu" aria-label="Open conversations" aria-expanded={open} onClick={() => show()}>
            <PanelLeft size={18} aria-hidden />
          </button>
          <span className="shell__title">demo-rag</span>
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
