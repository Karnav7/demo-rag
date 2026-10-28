import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { CypherStep, TraceStage } from '../../domain/types'

function CopyButton({ text, label, children }: { text: string; label: string; children?: (done: boolean) => React.ReactNode }) {
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
    <button type="button" className={children ? 'pill cy__copy-all' : 'act cy__copy'} aria-label={`Copy ${label}`} title={`Copy ${label}`} onClick={copy}>
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {children?.(done)}
    </button>
  )
}

export function CypherView({ steps, trace }: { steps: CypherStep[]; trace: TraceStage[] }) {
  if (steps.length === 0) return <p className="ev-empty">No Cypher was run for this answer.</p>
  const title = (s: CypherStep) => trace.find((t) => t.id === s.stage)?.title ?? s.stage
  const all = steps.map((s) => `// ${title(s)}\n${s.query}`).join('\n\n')
  return (
    <>
      <div className="cy__bar">
        <span>{steps.length} {steps.length === 1 ? 'query' : 'queries'} ran for this answer</span>
        <CopyButton text={all} label="all queries">
          {(done) => (done ? 'Copied' : 'Copy all')}
        </CopyButton>
      </div>
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
    </>
  )
}
