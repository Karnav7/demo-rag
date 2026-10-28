import { useMemo } from 'react'
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

/** Hover text for a citation: "[2] Section title, Document title". */
function citeTitles(citations: { n: number; section_id: string }[]): Map<number, string> {
  const w = loadWorld()
  const docs = new Map(w.documents.map((d) => [d.id, d.title]))
  return new Map(
    citations.map((c) => {
      const s = w.sectionById.get(c.section_id)
      const doc = s && docs.get(s.document_id)
      return [c.n, s ? `[${c.n}] ${s.title}${doc ? `, ${doc}` : ''}` : `Source ${c.n}`]
    }),
  )
}

/** Swaps known `[n]` markers in text nodes (outside code) for citation buttons; `known` maps n to its hover text. */
function linkCitations(html: string, known: Map<number, string> | null, conf?: Map<number, number>): string {
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
      const title = known?.get(n)
      if (title) b.title = title
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
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false, gfm: true, breaks: false })
    const clean = DOMPurify.sanitize(raw)
    return linkCitations(clean, citations ? citeTitles(citations) : null, citeConfidence)
  }, [text, citations, citeConfidence])

  const onClick = (e: React.MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.cite')
    if (!b || !onCite) return
    e.stopPropagation()
    onCite(Number(b.dataset.n))
  }

  // Cite buttons are real <button>s, so keyboard activation arrives here as a click too.
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
