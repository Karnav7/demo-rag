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

  // Escape closes the menu / confirm; a click elsewhere does too.
  useEffect(() => {
    if (mode !== 'menu' && mode !== 'confirm') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMode('idle')
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
    setMode('idle')
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
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') {
              e.stopPropagation()
              setMode('idle')
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
              <button type="button" className="conv__yes" onClick={() => onDelete(c.id)}>
                Delete? Yes
              </button>
              <button type="button" className="conv__no" onClick={() => setMode('idle')}>
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="conv__more"
              aria-label={`Options for ${c.title}`}
              aria-haspopup="menu"
              aria-expanded={mode === 'menu'}
              onClick={() => setMode(mode === 'menu' ? 'idle' : 'menu')}
            >
              <MoreHorizontal size={15} aria-hidden />
            </button>
          )}
          {mode === 'menu' && (
            <div className="conv__menu" role="menu">
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
