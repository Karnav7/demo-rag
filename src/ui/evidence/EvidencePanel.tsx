import { lazy, useRef, useState, type ComponentType } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Code2, FileText, Network, Table2, Timer, type LucideProps } from 'lucide-react'
import type { ChatResponse } from '../../domain/types'
import { DUR, EASE, useCountUp, useReducedMotion } from '../theme/motion'
import { CypherView } from './CypherView'
import { FactsTable } from './FactsTable'
import { firstCitedSection } from '../graph/graphStyle'
import { HelpPopover } from './HelpPopover'
import { LazyView } from '../shell/Boundary'
import { SourcesList } from './SourcesList'
import { TraceSteps } from './TraceSteps'
import { TAB_STYLES, useTabStyle, type TabStyle } from './tabStyle'
import './evidence.css'

/** The graph views (d3, layouts, Replay) load on first use, out of the main chunk. */
const GraphViews = lazy(() => import('../graph/GraphViews').then((m) => ({ default: m.GraphViews })))

export type EvidenceTab = 'graph' | 'facts' | 'sources' | 'cypher' | 'trace'

const TABS: { id: EvidenceTab; label: string; icon: ComponentType<LucideProps>; help: string }[] = [
  { id: 'graph', label: 'Subgraph', icon: Network, help: 'The slice of the knowledge graph this answer was built from. Highlighted nodes and edges are the ones the answer relied on.' },
  { id: 'facts', label: 'Facts', icon: Table2, help: 'Relationships pulled from the graph, each with a confidence score. Filter them, sort by any column, or keep only those the answer used.' },
  { id: 'sources', label: 'Sources', icon: FileText, help: 'The passages behind the answer, grouped by document. Clicking a citation jumps to the passage it points at.' },
  { id: 'cypher', label: 'Cypher', icon: Code2, help: 'The graph queries that ran for this answer, one per retrieval stage. Copy one, or all of them, to rerun against the same graph.' },
  { id: 'trace', label: 'Trace', icon: Timer, help: 'How long each pipeline stage took, with bars scaled to the slowest stage.' },
]

export function EvidencePanel({
  response,
  tab,
  onTab,
  highlightSectionId,
  onOpenSection,
  pending = false,
}: {
  response: ChatResponse | null
  /** The selected answer is still arriving: show a skeleton rather than the empty prompt. */
  pending?: boolean
  tab: EvidenceTab
  onTab(t: EvidenceTab): void
  /** Section to mark in the Sources tab (set by citation clicks). */
  highlightSectionId?: string
  /** A graph node was opened: reveal this section in Sources (the citation-click path). */
  onOpenSection?(sectionId: string): void
}) {
  const reduced = useReducedMotion()
  const [style, setStyle] = useTabStyle()
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  /** Feedback for a graph node with no cited passage to open; belongs to the response it was raised on. */
  const [note, setNote] = useState<{ for: ChatResponse; text: string } | null>(null)
  // Tab content slides in from the side it was chosen on; counts tick up for answers that arrive while mounted.
  const prevIdx = useRef(TABS.findIndex((t) => t.id === tab))
  const firstResponse = useRef(response)
  const dir = Math.sign(TABS.findIndex((t) => t.id === tab) - prevIdx.current)
  prevIdx.current = TABS.findIndex((t) => t.id === tab)
  const freshCounts = !!response && response !== firstResponse.current

  if (!response && pending) return <EvidenceSkeleton />
  if (!response) return <p className="evidence__empty">Ask a question to see its evidence.</p>

  const idx = TABS.findIndex((t) => t.id === tab)
  const counts: Partial<Record<EvidenceTab, number>> = {
    graph: response.subgraph.nodes.length,
    facts: response.facts.length,
    sources: response.sources.length,
  }
  /** What each stat card leads with (the other styles show the first three as count pills). */
  const metric: Record<EvidenceTab, string> = {
    graph: String(response.subgraph.nodes.length),
    facts: String(response.facts.length),
    sources: String(response.sources.length),
    cypher: String(response.cypher.length),
    trace: response.stats.totalMs >= 1000 ? `${(response.stats.totalMs / 1000).toFixed(1)}s` : `${response.stats.totalMs}ms`,
  }
  const vertical = style === 'rail'
  const onKey = (e: React.KeyboardEvent) => {
    const next = vertical ? 'ArrowDown' : 'ArrowRight'
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft'
    const step = e.key === next ? 1 : e.key === prev ? -1 : 0
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : step ? (idx + step + TABS.length) % TABS.length : -1
    if (to < 0) return
    e.preventDefault()
    onTab(TABS[to].id)
    refs.current[TABS[to].id]?.focus()
  }

  const ink = reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }
  const fade = reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE }
  return (
    <div className={`ev ev--${style}`}>
      <TabStylePicker style={style} onStyle={setStyle} />
      <div className="ev__frame">
      <div className="ev__tabs">
        <div
          className="ev__tablist"
          role="tablist"
          aria-label="Evidence"
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          onKeyDown={onKey}
        >
          {TABS.map((t) => {
            const on = t.id === tab
            const Icon = t.icon
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
                title={vertical ? t.label : undefined}
                onClick={() => onTab(t.id)}
              >
                {on && <motion.span layoutId={`ev-ink-${style}`} className="ev__ink" transition={ink} />}
                <Icon className="ev__icon" size={style === 'dock' ? 17 : style === 'rail' ? 18 : 14} aria-hidden />
                <span className={vertical ? 'sr-only' : 'ev__label'}>{t.label}</span>
                {style === 'cards' ? (
                  <span className="ev__metric" aria-hidden>{metric[t.id]}</span>
                ) : (
                  counts[t.id] !== undefined && !vertical && <TabCount value={counts[t.id]!} fresh={freshCounts} />
                )}
              </button>
            )
          })}
        </div>
        {!vertical && style !== 'dock' && <HelpPopover key={tab} text={TABS[idx].help} />}
      </div>
      <div className="ev__main">
      {(vertical || style === 'dock') && (
        <div className="ev__head">
          <h3 className="ev__title">
            {TABS[idx].label}
            {counts[tab] !== undefined && <span className="ev__title-count">{counts[tab]}</span>}
          </h3>
          <HelpPopover key={tab} text={TABS[idx].help} />
        </div>
      )}
      <div className="ev__pane" id="ev-pane" role="tabpanel" aria-labelledby={`ev-tab-${tab}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            className={`ev__body${tab === 'graph' ? ' ev__body--fill' : ''}`}
            initial={reduced ? false : { opacity: 0, x: dir * 6, y: dir ? 0 : 4 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, x: dir * -4 }}
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
      </div>
    </div>
  )
}

/** Temporary: switch the tab bar between the candidate designs to choose one. */
function TabStylePicker({ style, onStyle }: { style: TabStyle; onStyle(s: TabStyle): void }) {
  return (
    <div className="tsp" role="radiogroup" aria-label="Tab style (preview)">
      <span className="tsp__label" aria-hidden>Tab style</span>
      {TAB_STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={s.id === style}
          className="tsp__opt"
          title={s.hint}
          onClick={() => onStyle(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

/** Placeholder shapes for the evidence of an answer still on its way (tabs, a graph stage, a few rows). */
function EvidenceSkeleton() {
  return (
    <div className="ev ev--loading" role="status" aria-label="Gathering evidence…">
      <div className="ev-skel__tabs" aria-hidden>
        {TABS.map((t) => (
          <span key={t.id} className="ev-skel__bar ev-skel__tab" />
        ))}
      </div>
      <div className="ev-skel__body" aria-hidden>
        <span className="ev-skel__bar ev-skel__stage" />
        <span className="ev-skel__bar" />
        <span className="ev-skel__bar ev-skel__short" />
        <span className="ev-skel__bar" />
      </div>
    </div>
  )
}

function TabCount({ value, fresh }: { value: number; fresh: boolean }) {
  const shown = useCountUp(value, fresh, 450)
  return (
    <span className="ev__count" aria-hidden>
      {Math.round(shown)}
    </span>
  )
}
