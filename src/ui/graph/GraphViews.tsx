import { Component, lazy, Suspense, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { NodeLabel, Subgraph, TraceStage } from '../../domain/types'
import { DUR, EASE, useReducedMotion } from '../theme/motion'
import { Force } from './Force'
import { Legend } from './Legend'
import { Radial } from './Radial'
import { Replay } from './Replay'
import { LABEL_ORDER, WEBGL_FALLBACK, type GraphViewProps } from './graphStyle'
import './graph.css'

export type GraphVariant = 'force' | 'radial' | 'orbit' | 'three' | 'replay'
export type { GraphViewProps }

const KEY = 'dummy-rag.graph-variant'
const VARIANTS: { id: GraphVariant; label: string }[] = [
  { id: 'force', label: 'Force' },
  { id: 'radial', label: 'Radial' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'three', label: '3D' },
  { id: 'replay', label: 'Replay' },
]
const isVariant = (v: unknown): v is GraphVariant => VARIANTS.some((x) => x.id === v)

function readVariant(): GraphVariant {
  try {
    const v = localStorage.getItem(KEY)
    if (isVariant(v)) return v
  } catch {
    // storage unavailable
  }
  return 'force'
}

/** The depth views load on demand: Orbit is a plain canvas, 3D carries three.js in its own chunk. */
const Orbit = lazy(() => import('./Orbit'))
const Three = lazy(() => import('./Three'))

const VIEWS: Record<Exclude<GraphVariant, 'replay'>, ComponentType<GraphViewProps>> = {
  force: Force,
  radial: Radial,
  orbit: Orbit,
  three: Three,
}

/** What a view shows if it throws or its chunk fails to load; the switcher and other views keep working. */
const BROKEN: Partial<Record<GraphVariant, string>> = { three: WEBGL_FALLBACK }

class ViewBoundary extends Component<{ fallback: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <p className="ev-empty">{this.props.fallback}</p> : this.props.children
  }
}

export interface GraphViewsProps {
  subgraph: Subgraph
  trace: TraceStage[]
  /** A node was activated (click or Enter); the caller opens its first cited section, if any. */
  onNodeOpen(nodeId: string): void
}

export function GraphViews({ subgraph, trace, onNodeOpen }: GraphViewsProps) {
  const [variant, setVariant] = useState<GraphVariant>(readVariant)
  const [dim, setDim] = useState(false)
  const reduced = useReducedMotion()
  const refs = useRef<Partial<Record<GraphVariant, HTMLButtonElement | null>>>({})
  const counts = useMemo(() => {
    const c: Partial<Record<NodeLabel, number>> = {}
    for (const n of subgraph.nodes) c[n.label] = (c[n.label] ?? 0) + 1
    return c
  }, [subgraph])
  const labels = useMemo(() => LABEL_ORDER.filter((l) => counts[l]), [counts])

  if (!subgraph.nodes.length) return <p className="ev-empty">No graph for this answer.</p>

  const choose = (v: GraphVariant) => {
    setVariant(v)
    try {
      localStorage.setItem(KEY, v)
    } catch {
      // ignore persistence failures
    }
  }
  const idx = VARIANTS.findIndex((v) => v.id === variant)
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? VARIANTS.length - 1 : step ? (idx + step + VARIANTS.length) % VARIANTS.length : -1
    if (to < 0) return
    e.preventDefault()
    choose(VARIANTS[to].id)
    refs.current[VARIANTS[to].id]?.focus()
  }

  const View = variant === 'replay' ? null : VIEWS[variant]
  const fade = reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE }
  return (
    <div className="g">
      <div className="g__views" role="radiogroup" aria-label="Graph view" onKeyDown={onKey}>
        {VARIANTS.map((v) => {
          const on = v.id === variant
          return (
            <button
              key={v.id}
              ref={(el) => {
                refs.current[v.id] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className="g__view"
              onClick={() => choose(v.id)}
            >
              {on && <motion.span layoutId="g-view-pill" className="g__pill" transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }} />}
              <span className="g__view-label">{v.label}</span>
            </button>
          )
        })}
      </div>
      <div className="g__stage">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={variant} className="g__canvas" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
            <ViewBoundary fallback={BROKEN[variant] ?? "This view couldn't load. The other views still work."}>
              <Suspense fallback={<p className="ev-empty">Loading view…</p>}>
                {View ? (
                  <View subgraph={subgraph} dim={dim} onNodeOpen={onNodeOpen} />
                ) : (
                  <Replay subgraph={subgraph} trace={trace} dim={dim} onNodeOpen={onNodeOpen} />
                )}
              </Suspense>
            </ViewBoundary>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="g__foot">
        <Legend labels={labels} counts={counts} />
        <label className="g-switch">
          <input type="checkbox" role="switch" checked={dim} onChange={(e) => setDim(e.target.checked)} />
          <span className="g-switch__track" aria-hidden />
          <span>Dim everything the answer did not use</span>
        </label>
      </div>
    </div>
  )
}
