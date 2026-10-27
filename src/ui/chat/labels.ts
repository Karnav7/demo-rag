import type { Mode, Source } from '../../domain/types'

export const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'lexical', label: 'Lexical', hint: 'Full-text index on names and aliases' },
  { value: 'vector', label: 'Vector', hint: 'Embedding similarity' },
  { value: 'hybrid', label: 'Hybrid', hint: 'Lexical + vector fused with RRF' },
  { value: 'graph', label: 'Graph', hint: '3-hop traversal from the fused seeds' },
]

export const SOURCE_LABEL: Record<Source, string> = { live: 'Live Neo4j', offline: 'Offline snapshot' }
export const SOURCE_HINT: Record<Source, string> = {
  live: 'Bolt connection, Cypher per request',
  offline: 'Exported from the graph',
}

export const modeLabel = (m: Mode) => MODES.find((x) => x.value === m)?.label ?? m
