import { lazy, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ChatResponse } from '../../domain/types'
import { DUR, EASE, useReducedMotion } from '../theme/motion'
import { CypherView } from './CypherView'
import { FactsTable } from './FactsTable'
import { firstCitedSection } from '../graph/graphStyle'
import { HelpPopover } from './HelpPopover'
import { LazyView } from '../shell/Boundary'
import { SourcesList } from './SourcesList'
import { TraceSteps } from './TraceSteps'
import './evidence.css'

/** The graph views (d3, layouts, Replay) load on first use, out of the main chunk. */
const GraphViews = lazy(() => import('../graph/GraphViews').then((m) => ({ default: m.GraphViews })))

export type EvidenceTab = 'graph' | 'facts' | 'sources' | 'cypher' | 'trace'

const TABS: { id: EvidenceTab; label: string; help: string }[] = [
  { id: 'graph', label: 'Subgraph', help: 'The slice of the knowledge graph this answer was built from. Highlighted nodes and edges are the ones the answer relied on.' },
  { id: 'facts', label: 'Facts', help: 'Relationships pulled from the graph, each with a confidence score. Filter them, sort by any column, or keep only those the answer used.' },
  { id: 'sources', label: 'Sources', help: 'The passages behind the answer, grouped by document. Clicking a citation jumps to the passage it points at.' },
  { id: 'cypher', label: 'Cypher', help: 'The graph queries that ran for this answer, one per retrieval stage. Copy one, or all of them, to rerun against the same graph.' },
  { id: 'trace', label: 'Trace', help: 'How long each pipeline stage took, with bars scaled to the slowest stage.' },
]

export function EvidencePanel({
  response,
  tab,
  onTab,
  highlightSectionId,
  onOpenSection,
}: {
  response: ChatResponse | null
  tab: EvidenceTab
  onTab(t: EvidenceTab): void
  /** Section to mark in the Sources tab (set by citation clicks). */
  highlightSectionId?: string
  /** A graph node was opened: reveal this section in Sources (the citation-click path). */
  onOpenSection?(sectionId: string): void
}) {
  const reduced = useReducedMotion()
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  /** Feedback for a graph node with no cited passage to open; belongs to the response it was raised on. */
  const [note, setNote] = useState<{ for: ChatResponse; text: string } | null>(null)

  if (!response) return <p className="evidence__empty">Ask a question to see its evidence.</p>

  const idx = TABS.findIndex((t) => t.id === tab)
  const counts: Partial<Record<EvidenceTab, number>> = {
    graph: response.subgraph.nodes.length,
    facts: response.facts.length,
    sources: response.sources.length,
  }
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : step ? (idx + step + TABS.length) % TABS.length : -1
    if (to < 0) return
    e.preventDefault()
    onTab(TABS[to].id)
    refs.current[TABS[to].id]?.focus()
  }

  const ink = reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }
  const fade = reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE }
  return (
    <div className="ev">
      <div className="ev__tabs">
        <div className="ev__tablist" role="tablist" aria-label="Evidence" onKeyDown={onKey}>
          {TABS.map((t) => {
            const on = t.id === tab
            return (
              <button
                key={t.id}
                ref={(el) => { refs.current[t.id] = el }}
                type="button"
                role="tab"
                id={`ev-tab-${t.id}`}
                aria-selected={on}
                aria-controls="ev-pane"
                tabIndex={on ? 0 : -1}
                className="ev__tab"
                onClick={() => onTab(t.id)}
              >
                {t.label}
                {counts[t.id] !== undefined && (
                  <span className="ev__count" aria-hidden>
                    {counts[t.id]}
                  </span>
                )}
                {on && <motion.span layoutId="ev-ink" className="ev__ink" transition={ink} />}
              </button>
            )
          })}
        </div>
        <HelpPopover key={tab} text={TABS[idx].help} />
      </div>
      <div className="ev__pane" id="ev-pane" role="tabpanel" aria-labelledby={`ev-tab-${tab}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            className="ev__body"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={fade}
          >
            {tab === 'graph' && (
              <LazyView label="Loading graph…">
                <GraphViews
                  subgraph={response.subgraph}
                  trace={response.trace}
                  onNodeOpen={(id) => {
                    const s = firstCitedSection(response.subgraph, id, new Set(response.sources.map((x) => x.id)))
                    if (s) {
                      setNote(null)
                      onOpenSection?.(s)
                    } else {
                      const name = response.subgraph.nodes.find((n) => n.id === id)?.name ?? id
                      setNote({ for: response, text: `No cited passage for ${name}.` })
                    }
                  }}
                />
              </LazyView>
            )}
            {tab === 'graph' && (
              <p className="ev__note" role="status">
                {note?.for === response ? note.text : ''}
              </p>
            )}
            {tab === 'facts' && <FactsTable facts={response.facts} />}
            {tab === 'sources' && <SourcesList sources={response.sources} highlight={highlightSectionId} />}
            {tab === 'cypher' && <CypherView steps={response.cypher} trace={response.trace} />}
            {tab === 'trace' && <TraceSteps trace={response.trace} totalMs={response.stats.totalMs} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
