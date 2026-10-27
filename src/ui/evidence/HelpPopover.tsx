import { useId } from 'react'
import { HelpCircle } from 'lucide-react'
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
          {text}
        </div>
      )}
    </div>
  )
}
