import { createContext, useContext, useEffect, useState } from 'react'

/** Below this width the evidence column is a drawer. */
export const DRAWER_QUERY = '(max-width: 1099px)'

export function useDrawerMode(): boolean {
  const read = () => {
    try {
      return window.matchMedia(DRAWER_QUERY).matches
    } catch {
      return false
    }
  }
  const [narrow, setNarrow] = useState(read)
  useEffect(() => {
    try {
      const mq = window.matchMedia(DRAWER_QUERY)
      const on = () => setNarrow(mq.matches)
      mq.addEventListener('change', on)
      return () => mq.removeEventListener('change', on)
    } catch {
      return undefined
    }
  }, [])
  return narrow
}

/** Lets messages ask the chat view to reveal the evidence drawer (a no-op on wide screens). */
export const EvidenceDrawerContext = createContext<{ show(): void }>({ show() {} })
export const useEvidenceDrawer = () => useContext(EvidenceDrawerContext)
