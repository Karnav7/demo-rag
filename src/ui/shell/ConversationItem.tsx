import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { Conversation } from '../../store/store'

type Mode = 'idle' | 'menu' | 'rename' | 'confirm'

interface Props {
  conversation: Conversation
  active: boolean
  onOpen(id: string): void
  onRename(id: string, title: string): void
  onDelete(id: string): void
}

export function ConversationItem({ conversation: c, active, onOpen, onRename, onDelete }: Props) {
  const [mode, setMode] = useState<Mode>('idle')
  const [draft, setDraft] = useState(c.title)
  const rootRef = useRef<HTMLLIElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const yesRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)

  const close = () => {
    restoreFocus.current = true
    setMode('idle')
  }

  // Keep keyboard focus on a sensible control as the item changes mode.
  useEffect(() => {
    if (mode === 'menu') menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    else if (mode === 'confirm') yesRef.current?.focus()
    else if (mode === 'idle' && restoreFocus.current) {
      restoreFocus.current = false
      moreRef.current?.focus()
    }
  }, [mode])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next]?.focus()
  }

  // Escape closes the menu / confirm; a click elsewhere does too.
  useEffect(() => {
    if (mode !== 'menu' && mode !== 'confirm') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMode('idle')
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [mode])

  useEffect(() => {
    if (mode === 'rename') inputRef.current?.select()
  }, [mode])

  const commit = () => {
    const t = draft.trim()
    if (t && t !== c.title) onRename(c.id, t)
    close()
  }

  return (
    <li ref={rootRef} className={`conv${active ? ' conv--on' : ''}${mode !== 'idle' ? ' conv--busy' : ''}`}>
      {mode === 'rename' ? (
        <input
          ref={inputRef}
          className="conv__input"
          aria-label="Rename conversation"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setMode('idle')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
            else if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
          }}
        />
      ) : (
        <>
          <button type="button" className="conv__open" aria-current={active ? 'true' : undefined} onClick={() => onOpen(c.id)}>
            <span className="conv__title">{c.title}</span>
          </button>
          {mode === 'confirm' ? (
            <span className="conv__confirm">
              <button ref={yesRef} type="button" className="conv__yes" onClick={() => onDelete(c.id)}>
                Delete? Yes
              </button>
              <button type="button" className="conv__no" onClick={close}>
                No
              </button>
            </span>
          ) : (
            <button
              ref={moreRef}
              type="button"
              className="conv__more"
              aria-label={`Options for ${c.title}`}
              aria-haspopup="menu"
              aria-expanded={mode === 'menu'}
              onClick={() => (mode === 'menu' ? close() : setMode('menu'))}
            >
              <MoreHorizontal size={15} aria-hidden />
            </button>
          )}
          {mode === 'menu' && (
            <div ref={menuRef} className="conv__menu" role="menu" onKeyDown={onMenuKey}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDraft(c.title)
                  setMode('rename')
                }}
              >
                Rename
              </button>
              <button type="button" role="menuitem" className="conv__danger" onClick={() => setMode('confirm')}>
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </li>
  )
}
