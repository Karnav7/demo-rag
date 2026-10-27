import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Open/close state for a trigger + popup pair: focuses the first `itemSelector` on open,
 * closes on Escape or an outside press, and returns focus to the trigger when closed from inside.
 * Arrow keys move between items.
 */
export function usePopover(itemSelector: string) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const restore = useRef(false)

  const close = useCallback((refocus = true) => {
    restore.current = refocus
    setOpen(false)
  }, [])
  const toggle = useCallback(() => (open ? close() : setOpen(true)), [open, close])

  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLElement>(itemSelector)?.focus()
    else if (restore.current) {
      restore.current = false
      triggerRef.current?.focus()
    }
  }, [open, itemSelector])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault() // tells an enclosing drawer this key is spent
        close()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, close])

  const onPopKeyDown = (e: React.KeyboardEvent) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(e.key)) return
    e.preventDefault()
    const items = Array.from(popRef.current?.querySelectorAll<HTMLElement>(itemSelector) ?? [])
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (i + 1) % items.length
      : (i - 1 + items.length) % items.length
    items[next].focus()
  }

  return { open, toggle, close, rootRef, triggerRef, popRef, onPopKeyDown }
}
