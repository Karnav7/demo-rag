import { useId, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { loadWorld } from '../../data/load'
import { confLevel } from '../theme/scale'

interface Props {
  text: string
  /** Known citations; while undefined (still streaming) every `[n]` is styled as a cite. */
  citations?: { n: number; section_id: string }[]
  /** Confidence of the strongest fact behind each citation; tints its chip on the confidence ramp. */
  citeConfidence?: Map<number, number>
  onCite?(n: number): void
}

const CITE = /\[(\d+)\]/g

/** What a citation points at: its label, the passage's opening sentence, and the document it comes from. */
interface CiteInfo { label: string; title: string; snippet: string; doc: string }

const firstSentence = (t: string) => {
  const m = t.match(/^.*?[.!?](\s|$)/)
  const s = (m ? m[0] : t).trim()
  return s.length > 180 ? `${s.slice(0, 177)}…` : s
}

function citeInfo(citations: { n: number; section_id: string }[]): Map<number, CiteInfo> {
  const w = loadWorld()
  const docs = new Map(w.documents.map((d) => [d.id, d.title]))
  return new Map(
    citations.map((c) => {
      const s = w.sectionById.get(c.section_id)
      const doc = (s && docs.get(s.document_id)) ?? ''
      return [c.n, { label: `Source ${c.n}`, title: s?.title ?? `Source ${c.n}`, snippet: s ? firstSentence(s.text) : '', doc }]
    }),
  )
}

/** Swaps known `[n]` markers in text nodes (outside code) for citation buttons; `known` maps n to its hover text. */
function linkCitations(html: string, known: Map<number, CiteInfo> | null, conf?: Map<number, number>): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!n.parentElement?.closest('code, pre') && /\[\d+\]/.test(n.data)) nodes.push(n)
  }
  for (const node of nodes) {
    const frag = document.createDocumentFragment()
    let last = 0
    for (const m of node.data.matchAll(CITE)) {
      const n = Number(m[1])
      if (known && !known.has(n)) continue
      frag.append(node.data.slice(last, m.index))
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'cite'
      b.dataset.n = String(n)
      b.setAttribute('aria-label', `Source ${n}`)
      const c = conf?.get(n)
      if (c !== undefined) b.style.setProperty('--cite', `var(--conf-${confLevel(c)})`)
      b.textContent = String(n)
      frag.append(b)
      last = m.index + m[0].length
    }
    frag.append(node.data.slice(last))
    node.replaceWith(frag)
  }
  return tpl.innerHTML
}

/** Renders answer markdown, sanitised, with `[n]` turned into `<button class="cite" data-n>`. */
export function Markdown({ text, citations, citeConfidence, onCite }: Props) {
  const info = useMemo(() => (citations ? citeInfo(citations) : null), [citations])
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false, gfm: true, breaks: false })
    const clean = DOMPurify.sanitize(raw)
    return linkCitations(clean, info, citeConfidence)
  }, [text, info, citeConfidence])

  // Citation preview: a glass card above the hovered or focused chip.
  const wrapRef = useRef<HTMLDivElement>(null)
  const tipId = useId()
  const [tip, setTip] = useState<{ n: number; x: number; y: number; tint: string } | null>(null)
  const show = (target: EventTarget) => {
    const b = (target as HTMLElement).closest?.<HTMLButtonElement>('button.cite')
    const wrap = wrapRef.current
    if (!b || !wrap || !info?.has(Number(b.dataset.n))) return
    const r = b.getBoundingClientRect()
    const w = wrap.getBoundingClientRect()
    b.setAttribute('aria-describedby', tipId)
    setTip({ n: Number(b.dataset.n), x: r.left - w.left + r.width / 2, y: r.top - w.top, tint: b.style.getPropertyValue('--cite') })
  }
  const hide = (target: EventTarget) => {
    ;(target as HTMLElement).closest?.('button.cite')?.removeAttribute('aria-describedby')
    setTip(null)
  }
  const cur = tip && info?.get(tip.n)

  const onClick = (e: React.MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.cite')
    if (!b || !onCite) return
    e.stopPropagation()
    onCite(Number(b.dataset.n))
  }

  // Cite buttons are real <button>s, so keyboard activation arrives here as a click too.
  return (
    <div
      className="md-wrap"
      ref={wrapRef}
      onMouseOver={(e) => show(e.target)}
      onMouseOut={(e) => hide(e.target)}
      onFocus={(e) => show(e.target)}
      onBlur={(e) => hide(e.target)}
    >
      <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {cur && tip && (
        <span
          id={tipId}
          role="tooltip"
          className="cite-tip"
          style={{ left: tip.x, top: tip.y, ...(tip.tint ? { '--cite-tip-accent': tip.tint } : {}) } as React.CSSProperties}
        >
          <span className="cite-tip__src">[{tip.n}] {cur.title}</span>
          {cur.snippet}
          {cur.doc && <span className="cite-tip__doc">{cur.doc}</span>}
        </span>
      )}
    </div>
  )
}
