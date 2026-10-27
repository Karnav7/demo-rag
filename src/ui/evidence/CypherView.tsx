import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { CypherStep, TraceStage } from '../../domain/types'

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setDone(false), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button type="button" className="act cy__copy" aria-label={`Copy ${label}`} title="Copy query" onClick={copy}>
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  )
}

export function CypherView({ steps, trace }: { steps: CypherStep[]; trace: TraceStage[] }) {
  if (steps.length === 0) return <p className="ev-empty">No Cypher was run for this answer.</p>
  const title = (s: CypherStep) => trace.find((t) => t.id === s.stage)?.title ?? s.stage
  return (
    <ol className="cy" aria-label="Cypher steps">
      {steps.map((s, i) => (
        <li key={`${s.stage}-${i}`} className="cy__step">
          <div className="cy__head">
            <span className="cy__stage">{title(s)}</span>
            <CopyButton text={s.query} label={`${title(s)} query`} />
          </div>
          <p className="cy__explain">{s.explain}</p>
          <pre className="cy__code"><code>{s.query}</code></pre>
        </li>
      ))}
    </ol>
  )
}
