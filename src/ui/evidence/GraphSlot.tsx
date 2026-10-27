import type { Subgraph } from '../../domain/types'

/** The props Task 11's `<GraphViews/>` receives from the Subgraph tab. */
export interface GraphViewsProps {
  subgraph: Subgraph
  /** Section to emphasise (kept in sync with the Sources tab). */
  highlightSectionId?: string
}

/** Placeholder until Task 11 replaces it: swap this import in EvidencePanel for the real GraphViews. */
export function GraphViews(_props: GraphViewsProps) {
  return <p className="ev-empty">No graph for this answer.</p>
}
