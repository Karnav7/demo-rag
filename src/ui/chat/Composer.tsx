import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Check, ChevronDown, Database, Layers } from 'lucide-react'
import { useAppStore } from '../../store/StoreProvider'
import { isLiveSimulated } from '../../client/chatClient'
import type { Mode, Source } from '../../domain/types'
import { MODES, SOURCE_HINT, SOURCE_LABEL } from './labels'
import { usePopover } from './usePopover'

export const COMPOSER_INPUT_ID = 'composer-input'

interface Option<T> { value: T; label: string; hint: string }

function Select<T extends string>(props: { label: string; icon: ReactNode; value: T; options: Option<T>[]; onChange(v: T): void }) {
  const { label, icon, value, options, onChange } = props
  const pop = usePopover('[role="option"]')
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <div className="sel" ref={pop.rootRef}>
      <button
        ref={pop.triggerRef}
        type="button"
        className="pill sel__btn"
        aria-haspopup="listbox"
        aria-expanded={pop.open}
        onClick={pop.toggle}
      >
        <span className="sr-only">{label}: </span>
        {icon}
        <span className="sel__value">{current.label}</span>
        <ChevronDown className="sel__chev" size={13} aria-hidden />
      </button>
      {pop.open && (
        <div ref={pop.popRef} className="sel__pop" role="listbox" aria-label={label} onKeyDown={pop.onPopKeyDown}>
          <p className="sel__head" aria-hidden>{label}</p>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="sel__opt"
              onClick={() => {
                onChange(o.value)
                pop.close()
              }}
            >
              <span className="sel__text">
                <span className="sel__label">{o.label}</span>
                <span className="sel__hint">{o.hint}</span>
              </span>
              <Check className="sel__check" size={14} aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Toggle({ label, aria, on, onChange }: { label: string; aria: string; on: boolean; onChange(v: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={aria} title={aria} className="pill tog" onClick={() => onChange(!on)}>
      <span className="tog__track" aria-hidden>
        <span className="tog__thumb" />
      </span>
      {label}
    </button>
  )
}

export function Composer() {
  const { settings, patchSettings, send } = useAppStore()
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const empty = !text.trim()

  // Grow with the content up to the CSS max-height.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const submit = () => {
    if (empty) return
    void send(text)
    setText('')
  }

  const liveLabel = SOURCE_LABEL.live + (isLiveSimulated() ? ' (simulated)' : '')
  const sources: Option<Source>[] = [
    { value: 'live', label: liveLabel, hint: SOURCE_HINT.live },
    { value: 'offline', label: SOURCE_LABEL.offline, hint: SOURCE_HINT.offline },
  ]

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <textarea
        id={COMPOSER_INPUT_ID}
        ref={ref}
        className="composer__input"
        aria-label="Ask a question"
        placeholder="Ask about a company, person, account or transaction…"
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="composer__bar">
        <div className="composer__opts">
          <Select<Source>
            label="Data source"
            icon={<Database size={13} aria-hidden />}
            value={settings.source}
            options={sources}
            onChange={(source) => patchSettings({ source })}
          />
          <Select<Mode>
            label="Retrieval mode"
            icon={<Layers size={13} aria-hidden />}
            value={settings.mode}
            options={MODES}
            onChange={(mode) => patchSettings({ mode })}
          />
          <Toggle
            label="Context"
            aria="Use conversation context to resolve follow-ups"
            on={settings.useContext}
            onChange={(useContext) => patchSettings({ useContext })}
          />
          <Toggle
            label="LLM"
            aria="Generate an LLM answer (off = extractive facts only)"
            on={settings.generateAnswer}
            onChange={(generateAnswer) => patchSettings({ generateAnswer })}
          />
        </div>
        <button type="submit" className="composer__send" aria-label="Send" disabled={empty}>
          <ArrowUp size={16} aria-hidden />
        </button>
      </div>
    </form>
  )
}
