import type { ChatRequest, ChatResponse, CypherStep, Fact, GNode, GRel, Section, StageId, Subgraph, TraceStage } from '../domain/types'
import type { WorldIndex } from '../data/load'
import { resolveContext } from './context'
import { expand, jurisdictionsIn, type Expansion } from './expand'
import { rrf, type Hit } from './fuse'
import { lexicalSearch } from './lexical'
import { rankFacts } from './rank'
import { vectorSearch } from './vector'
import { ALL_TYPES, INTENTS, classify, hopsFor, matchIntent, pickFocal, type Intent } from './intents'
import { Citations, NO_MATCH, composeAnswer, extractive, fallbackLead, followUps } from './answer'
import { expandCypher, fuseCypher, lexicalCypher, passagesCypher, rankCypher, seedsCypher, vectorCypher } from './cypher'

const K = 12
const RRF_K = 60
/** Seeds: up to 3 fused hits that are strong in at least one retriever. */
const MAX_SEEDS = 3
const LEX_RELATIVE = 0.5
const VEC_RELATIVE = 0.8
const VEC_FLOOR = 0.3
/** Facts returned beyond the ones the answer cites. */
const MAX_FACTS = 40
const FALLBACK_FACTS = 6
const EXTRACTIVE_FACTS = 12

export const STAGE_TITLES: Record<StageId, string> = {
  context: 'Resolve conversation context',
  lexical: 'Lexical match (full-text index)',
  vector: 'Vector match (embedding index)',
  fuse: 'Fuse (reciprocal rank fusion)',
  seeds: 'Seed selection for traversal',
  expand: 'Graph expand (APOC path walk)',
  rank: 'Rank facts by confidence × proximity',
  passages: 'Fetch cited passages',
  generate: 'Generate grounded answer',
  extractive: 'Extractive answer',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function topHits(w: WorldIndex, hits: Hit[], fmt: (s: number) => string): string {
  return hits.slice(0, 3).map((h) => `${w.byId.get(h.id)?.name ?? h.id} (${fmt(h.score)})`).join(', ')
}

/** Fused hits strong in at least one retriever: lexical within half the best BM25 score, or vector near the best cosine. */
export function selectSeeds(ranked: Hit[], lexical: Hit[], vector: Hit[]): string[] {
  const lex = new Map(lexical.map((h) => [h.id, h.score]))
  const vec = new Map(vector.map((h) => [h.id, h.score]))
  const lexMin = (lexical[0]?.score ?? 0) * LEX_RELATIVE
  const vecMin = Math.max(VEC_FLOOR, (vector[0]?.score ?? 0) * VEC_RELATIVE)
  const strong = (id: string) => (lex.has(id) && lex.get(id)! >= lexMin) || (vec.get(id) ?? 0) >= vecMin
  return ranked.filter((h) => strong(h.id)).slice(0, MAX_SEEDS).map((h) => h.id)
}

/** Hop distance from the nearest seed over the evidence relationships (undirected). */
function distances(seeds: string[], rels: GRel[]): Map<string, number> {
  const adj = new Map<string, string[]>()
  for (const r of rels) {
    adj.set(r.from, [...(adj.get(r.from) ?? []), r.to])
    adj.set(r.to, [...(adj.get(r.to) ?? []), r.from])
  }
  const dist = new Map(seeds.map((s) => [s, 0]))
  let frontier = [...seeds]
  for (let d = 1; frontier.length; d++) {
    const next: string[] = []
    for (const id of frontier) for (const o of adj.get(id) ?? []) if (!dist.has(o)) (dist.set(o, d), next.push(o))
    frontier = next
  }
  return dist
}

function mergeRels(...lists: GRel[][]): GRel[] {
  const m = new Map<string, GRel>()
  for (const l of lists) for (const r of l) m.set(r.id, r)
  return [...m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function runPipeline(w: WorldIndex, req: ChatRequest): { stages: TraceStage[]; response: ChatResponse } {
  const { settings } = req
  const stages: TraceStage[] = []
  const cypher: CypherStep[] = []
  const stage = (id: StageId, detail: string, step?: CypherStep) => {
    stages.push({ id, title: STAGE_TITLES[id], ms: 0, detail })
    if (step) cypher.push(step)
  }

  // 1. Context
  let question = req.question.trim()
  let resolvedQuestion: string | null = null
  if (settings.useContext) {
    const ctx = resolveContext(question, req.history, w)
    if (ctx.changed) question = resolvedQuestion = ctx.resolved
    stage('context', ctx.detail)
  } else {
    stage('context', 'Context disabled.')
  }

  // 2–4. Retrieval
  const useLexical = settings.mode !== 'vector'
  const useVector = settings.mode !== 'lexical'
  let lexical: Hit[] = []
  let vector: Hit[] = []
  if (useLexical) {
    lexical = lexicalSearch(w, question, K)
    stage('lexical', lexical.length ? `${plural(lexical.length, 'hit')} on entity names and aliases. Top: ${topHits(w, lexical, (s) => s.toFixed(2))}.` : 'No entity name or alias matched the question.', lexicalCypher(question, K))
  }
  if (useVector) {
    vector = vectorSearch(w, question, K)
    stage('vector', `${plural(vector.length, 'nearest entity', 'nearest entities')}. Top: ${topHits(w, vector, (s) => s.toFixed(3))}.`, vectorCypher(question, K))
  }
  let ranked = useLexical ? lexical : vector
  if (useLexical && useVector) {
    ranked = rrf([lexical, vector], RRF_K)
    stage('fuse', `Fused ${lexical.length} lexical and ${vector.length} vector hits into ${plural(ranked.length, 'candidate')}. Top: ${topHits(w, ranked, (s) => s.toFixed(4))}.`, fuseCypher(lexical.map((h) => h.id), vector.map((h) => h.id), RRF_K))
  }

  // 5. Seeds
  const seeds = selectSeeds(ranked, lexical, vector)
  const intent: Intent = classify(question)
  const focal = pickFocal(w, intent, seeds)
  const seedNames = seeds.map((id) => `${w.byId.get(id)!.name} (${w.byId.get(id)!.label})`)
  stage('seeds', seeds.length ? `${plural(seeds.length, 'seed')}: ${seedNames.join(', ')}. Intent: ${intent}; focus: ${focal!.name}.` : 'No entity matched the question strongly enough to seed a traversal.', seedsCypher(seeds))

  // 6. Expand: a bounded walk along the intent's relationship types, plus the intent's own pattern.
  const spec = INTENTS[intent]
  const hops = hopsFor(intent, settings.mode)
  const jurisdictions = jurisdictionsIn(w, question)
  let types = spec.types
  let exp: Expansion = expand(w, seeds, { hops, types, jurisdictions })
  const match = focal ? matchIntent(w, intent, focal, exp, question, jurisdictions) : null
  let rels = mergeRels(exp.rels, match?.rels ?? [])
  let widened = false
  if (seeds.length && !rels.length) {
    // The intent's relationships don't touch the seeds; fall back to their whole 1-hop neighbourhood.
    types = ALL_TYPES
    exp = expand(w, seeds, { hops: 1, types, jurisdictions })
    rels = exp.rels
    widened = true
  }
  const dist = distances(seeds, rels)
  const scope = jurisdictions ? `, scoped to ${jurisdictions.join(', ')}` : ''
  stage(
    'expand',
    seeds.length
      ? `${widened ? `Nothing along ${spec.types.join('|')}; widened to every relationship type at 1 hop` : `${plural(hops, 'hop')} along ${types.join('|')}`}${scope}. ${plural(dist.size, 'node')}, ${plural(rels.length, 'relationship')}${match && match.rels.length && !widened ? ` (${match.rels.length} from the ${intent} pattern)` : ''}.`
      : 'Nothing to expand without seeds.',
    expandCypher({ seedIds: seeds, hops: widened ? 1 : hops, types, jurisdictions, intent, focalId: focal?.id ?? null, focalLabel: focal?.label ?? null }),
  )

  // 7. Rank
  const ranking = rankFacts(w, rels, dist)
  stage('rank', ranking.length ? `Ranked ${plural(ranking.length, 'fact')}. Top: ${ranking[0].subject} ${ranking[0].relation} ${ranking[0].object} (${ranking[0].confidence}).` : 'No facts to rank.', rankCypher(rels.map((r) => r.id), Object.fromEntries(dist)))

  // 8. Passages
  const sectionIds = [...new Set(ranking.map((f) => f.section_id).filter((s): s is string => !!s))]
  const docs = new Set(sectionIds.map((s) => w.sectionById.get(s)?.document_id))
  stage('passages', sectionIds.length ? `Fetched ${plural(sectionIds.length, 'passage')} from ${plural(docs.size, 'document')}.` : 'No passages to fetch.', passagesCypher(rels.map((r) => r.id)))

  // 9. Answer
  const relById = new Map(rels.map((r) => [r.id, r]))
  const topRels = (n: number) => ranking.slice(0, n).map((f) => relById.get(f.rel_id)!)
  let c = new Citations()
  let answer: string
  let detail: string
  if (!seeds.length) {
    answer = NO_MATCH
    detail = 'No seeds, so nothing to ground an answer on.'
  } else if (settings.generateAnswer) {
    const templated = match && !widened ? composeAnswer(w, match, c) : null
    if (templated) {
      answer = templated
      detail = `Templated ${intent} answer citing ${plural(c.used.size, 'fact')} from ${plural(c.list().length, 'passage')}.`
    } else {
      c = new Citations() // whatever the empty template touched must not count as used
      const facts = topRels(FALLBACK_FACTS)
      answer = facts.length ? `${fallbackLead(intent, focal!)}\n\n${extractive(w, facts, c)}` : `${focal!.name} is in the graph, but no relationships are recorded for it.`
      detail = `No ${intent} pattern matched, so the answer lists the top ${plural(facts.length, 'fact')} instead.`
    }
  } else {
    // Without the LLM pass: the facts the template would have cited, verbatim; else the top-ranked facts.
    const probe = new Citations()
    if (match && !widened) composeAnswer(w, match, probe)
    const facts = (probe.order.length ? probe.order : topRels(EXTRACTIVE_FACTS)).slice(0, EXTRACTIVE_FACTS)
    answer = facts.length ? extractive(w, facts, c) : `- ${focal!.name} has no recorded relationships.`
    detail = 'Returned the grounding facts verbatim without an LLM pass.'
  }
  answer = c.finalize(answer)
  if (settings.generateAnswer) stage('generate', detail)
  else stage('extractive', 'Returned the grounding facts verbatim without an LLM pass.')

  // Evidence: the ranked facts (all cited ones, plus the best of the rest) and the subgraph they span.
  const facts: Fact[] = ranking
    .filter((f, i) => i < MAX_FACTS || c.used.has(f.rel_id))
    .map((f) => ({ ...f, used: c.used.has(f.rel_id) }))
  const edges = facts.map((f) => ({ ...relById.get(f.rel_id)!, used: f.used }))
  const nodeIds = new Set<string>(seeds)
  for (const e of edges) nodeIds.add(e.from).add(e.to)
  const usedNodes = new Set<string>(focal ? [focal.id] : [])
  for (const e of edges) if (e.used) usedNodes.add(e.from).add(e.to)
  const subgraph: Subgraph = {
    nodes: [...nodeIds].sort().map((id) => ({ ...(w.byId.get(id) as GNode), used: usedNodes.has(id), seed: seeds.includes(id) })),
    edges,
  }
  if (!seeds.length) subgraph.nodes = []

  const used = facts.filter((f) => f.used)
  const confidence = used.length ? Math.round((used.reduce((a, f) => a + f.confidence, 0) / used.length) * 100) / 100 : 0
  const citations = c.list()
  const sources: Section[] = citations.map((x) => w.sectionById.get(x.section_id)!).filter(Boolean)

  const response: ChatResponse = {
    answer,
    citations,
    facts: seeds.length ? facts : [],
    sources,
    cypher,
    trace: stages,
    subgraph,
    confidence,
    resolvedQuestion,
    followUps: followUps(intent, focal),
    stats: { totalMs: 0, settings },
  }
  return { stages, response }
}
