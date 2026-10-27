import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Shared behaviour for the sidebar and evidence drawers: focus moves in on open and back to whatever opened it
 * on close, Escape closes (unless an inner popover already handled it), and the page behind becomes inert so
 * Tab cannot leave the drawer.
 */
export function useDrawer({
  enabled,
  focusSelector,
  background,
}: {
  /** Whether the layout currently uses a drawer; leaving that layout closes it. */
  enabled: boolean
  /** Element inside the drawer that receives focus on open. */
  focusSelector: string
  /** Elements to make inert while the drawer is shown. */
  background: () => Element[]
}) {
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const wasShown = useRef(false)
  const bg = useRef(background)
  bg.current = background
  const shown = enabled && open

  const show = useCallback(() => {
    if (!open) returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(true)
  }, [open])
  const hide = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (shown) document.querySelector<HTMLElement>(focusSelector)?.focus()
    else if (wasShown.current) (returnTo.current?.isConnected ? returnTo.current : openerRef.current)?.focus()
    wasShown.current = shown
  }, [shown, focusSelector])

  // Listen on window (after document-level popover handlers) and yield to a popover that took the key.
  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown])

  useEffect(() => {
    if (!shown) return
    const made = bg.current().filter((el) => !el.hasAttribute('inert'))
    made.forEach((el) => el.setAttribute('inert', ''))
    return () => made.forEach((el) => el.removeAttribute('inert'))
  }, [shown])

  useEffect(() => {
    if (!enabled) setOpen(false)
  }, [enabled])

  return { open, shown, show, hide, openerRef }
}
