import { useEffect, useMemo, useRef } from 'react'
import type { Section } from '../../domain/types'
import { loadWorld } from '../../data/load'
import { useReducedMotion } from '../theme/motion'

const KIND_LABEL: Record<string, string> = {
  registry: 'Registry', kyc: 'KYC', 'case-note': 'Case note', sar: 'SAR', sanctions: 'Sanctions', regulation: 'Regulation',
}

export function SourcesList({ sources, highlight }: { sources: Section[]; highlight?: string }) {
  const reduced = useReducedMotion()
  const marked = useRef<HTMLElement>(null)
  const groups = useMemo(() => {
    const docs = new Map(loadWorld().documents.map((d) => [d.id, d]))
    const by = new Map<string, Section[]>()
    for (const s of sources) by.set(s.document_id, [...(by.get(s.document_id) ?? []), s])
    return [...by].map(([id, sections]) => ({ id, doc: docs.get(id), sections }))
  }, [sources])

  useEffect(() => {
    marked.current?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [highlight, reduced])

  if (sources.length === 0) return <p className="ev-empty">No sources for this answer.</p>
  return (
    <div className="sources">
      {groups.map(({ id, doc, sections }) => (
        <section key={id} className="doc" aria-label={doc?.title ?? id}>
          <header className="doc__head">
            {doc && <span className="badge">{KIND_LABEL[doc.kind] ?? doc.kind}</span>}
            <h3 className="doc__title">{doc?.title ?? id}</h3>
            {doc && <time className="doc__date" dateTime={doc.date}>{doc.date}</time>}
          </header>
          {sections.map((s) => {
            const on = s.id === highlight
            return (
              <article
                key={s.id}
                ref={on ? marked : undefined}
                id={`ev-sec-${s.id}`}
                className={`sec${on ? ' sec--marked' : ''}`}
                aria-current={on ? 'true' : undefined}
              >
                <h4 className="sec__title">{s.title}</h4>
                <p className="sec__text">{s.text}</p>
              </article>
            )
          })}
        </section>
      ))}
    </div>
  )
}
