import { useEffect, useState, type ReactNode } from 'react'
import './pages.css'

export interface TocItem { id: string; title: string }

export function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <pre className="code" role="region" aria-label={`${label} code`} tabIndex={0}>
      <code>{children}</code>
    </pre>
  )
}

export function Sec({ id, title, children }: TocItem & { children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="page__sec">
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  )
}

/** Tracks which section crosses the upper third of the viewport. No-ops where IntersectionObserver is missing (jsdom). */
function useActiveId(ids: string[]): [string, (id: string) => void] {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        const first = ids.find((id) => seen.get(id))
        if (first) setActive(first)
      },
      { rootMargin: '-10% 0px -65% 0px' },
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [ids])
  return [active, setActive]
}

export function Page(props: { title: string; lede: string; toc: TocItem[]; children: ReactNode }) {
  const ids = props.toc.map((t) => t.id)
  const [active, setActive] = useActiveId(ids)
  return (
    <div className="page">
      <header className="page__head">
        <h1>{props.title}</h1>
        <p className="page__lede">{props.lede}</p>
      </header>
      <div className="page__grid">
        <nav className="toc" aria-label="On this page">
          <ol>
            {props.toc.map((t) => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  aria-current={active === t.id ? 'location' : undefined}
                  onClick={(e) => {
                    // HashRouter owns the hash, so scroll by hand instead of navigating.
                    e.preventDefault()
                    document.getElementById(t.id)?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth', block: 'start' })
                    setActive(t.id)
                  }}
                >
                  {t.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="page__body">{props.children}</div>
      </div>
      <footer className="page__foot">Fictional data for demonstration. Not financial or legal advice.</footer>
    </div>
  )
}
