import type { TraceStage } from '../../domain/types'

export function TraceSteps({ trace, totalMs }: { trace: TraceStage[]; totalMs: number }) {
  if (trace.length === 0) return <p className="ev-empty">No trace for this answer.</p>
  const max = Math.max(1, ...trace.map((t) => t.ms))
  return (
    <div className="trace">
      <ol className="trace__list" aria-label="Pipeline stages">
        {trace.map((t, i) => (
          <li key={`${t.id}-${i}`} className="trace__step">
            <div className="trace__row">
              <span className="trace__title">{t.title}</span>
              <span className="trace__ms">{t.ms} ms</span>
            </div>
            <span className="trace__bar" aria-hidden>
              <span className="trace__fill" style={{ transform: `scaleX(${Math.max(0.02, t.ms / max)})` }} />
            </span>
            <p className="trace__detail">{t.detail}</p>
          </li>
        ))}
      </ol>
      <p className="trace__total">
        <span>Total</span>
        <b>{totalMs} ms</b>
      </p>
    </div>
  )
}
