import { useId } from 'react'
import { ArrowRight, HelpCircle } from 'lucide-react'
import { usePopover } from '../chat/usePopover'

export function HelpPopover({ text }: { text: string }) {
  const pop = usePopover('[data-pop]')
  const id = useId()
  return (
    <div className="help" ref={pop.rootRef}>
      <button
        ref={pop.triggerRef}
        type="button"
        className="help__btn"
        aria-label="What is this tab?"
        aria-expanded={pop.open}
        aria-controls={pop.open ? id : undefined}
        onClick={pop.toggle}
      >
        <HelpCircle size={14} aria-hidden />
      </button>
      {pop.open && (
        <div ref={pop.popRef} id={id} className="help__pop" role="note" tabIndex={-1} data-pop>
          <p className="help__text">{text}</p>
          {/* A plain hash link: the app runs under HashRouter, and the panel also renders outside a router in tests. */}
          <a className="help__link" href="#/guide">
            Full guide <ArrowRight size={12} aria-hidden />
          </a>
        </div>
      )}
    </div>
  )
}
