import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

interface Props {
  text: string
  /** Known citations; while undefined (still streaming) every `[n]` is styled as a cite. */
  citations?: { n: number; section_id: string }[]
  onCite?(n: number): void
}

const CITE = /\[(\d+)\]/g

/** Swaps known `[n]` markers in text nodes (outside code) for citation buttons. */
function linkCitations(html: string, known: Set<number> | null): string {
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
export function Markdown({ text, citations, onCite }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false, gfm: true, breaks: false })
    const clean = DOMPurify.sanitize(raw)
    return linkCitations(clean, citations ? new Set(citations.map((c) => c.n)) : null)
  }, [text, citations])

  const onClick = (e: React.MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.cite')
    if (!b || !onCite) return
    e.stopPropagation()
    onCite(Number(b.dataset.n))
  }

  // Cite buttons are real <button>s, so keyboard activation arrives here as a click too.
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
