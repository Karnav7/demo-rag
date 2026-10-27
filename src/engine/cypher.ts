import type { CypherStep, RelType } from '../domain/types'
import type { Intent } from './intents'
import { SANCTIONS_TYPES } from './intents'

// Cypher for each executed stage, valid against the dataset's Neo4j schema: entity nodes carry `id`, `name`
// and `jurisdiction`; relationships carry `id`, `confidence`, `section_id` and their props flattened.
// Parameter values are shown in leading comments.

const LIST_PREVIEW = 8

function literal(v: unknown): string {
  if (Array.isArray(v)) {
    const shown = v.slice(0, LIST_PREVIEW).map((x) => JSON.stringify(x)).join(', ')
    return v.length > LIST_PREVIEW ? `[${shown}, … ${v.length - LIST_PREVIEW} more]` : `[${shown}]`
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v)
    const shown = entries.slice(0, LIST_PREVIEW).map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(', ')
    return entries.length > LIST_PREVIEW ? `{${shown}, … ${entries.length - LIST_PREVIEW} more}` : `{${shown}}`
  }
  return JSON.stringify(v)
}

function params(p: Record<string, unknown>): string {
  return Object.entries(p).map(([k, v]) => `// $${k} = ${literal(v)}`).join('\n')
}

export function lexicalCypher(q: string, k: number): CypherStep {
  return {
    stage: 'lexical',
    query: `${params({ q, k })}
CALL db.index.fulltext.queryNodes('entityNames', $q) YIELD node, score
RETURN node.id AS id, labels(node)[0] AS label, node.name AS name, score
ORDER BY score DESC
LIMIT $k`,
    explain: 'Full-text (BM25) search over entity names and aliases. Document and Section nodes are not in the index.',
  }
}

export function vectorCypher(q: string, k: number): CypherStep {
  return {
    stage: 'vector',
    query: `${params({ q })}
// $embedding = embedding of $q, computed by the client
CALL db.index.vector.queryNodes('entityEmbeddings', ${k}, $embedding) YIELD node, score
RETURN node.id AS id, labels(node)[0] AS label, node.name AS name, score
ORDER BY score DESC`,
    explain: `Nearest ${k} entities by cosine similarity, so paraphrases and partial names still match.`,
  }
}

export function fuseCypher(lexical: string[], vector: string[], k: number): CypherStep {
  return {
    stage: 'fuse',
    query: `${params({ lexical, vector, k })}
WITH $lexical AS lex, $vector AS vec
UNWIND apoc.coll.toSet(lex + vec) AS id
WITH id, apoc.coll.indexOf(lex, id) AS lr, apoc.coll.indexOf(vec, id) AS vr
RETURN id,
  (CASE WHEN lr >= 0 THEN 1.0 / ($k + lr + 1) ELSE 0.0 END) +
  (CASE WHEN vr >= 0 THEN 1.0 / ($k + vr + 1) ELSE 0.0 END) AS rrf
ORDER BY rrf DESC, id`,
    explain: `Reciprocal rank fusion of the two ranked lists: each list adds 1 / (${k} + rank).`,
  }
}

export function seedsCypher(seedIds: string[]): CypherStep {
  return {
    stage: 'seeds',
    query: `${params({ seedIds })}
MATCH (seed) WHERE seed.id IN $seedIds
RETURN seed.id AS id, labels(seed)[0] AS label, seed.name AS name`,
    explain: 'The strongest fused hits become the starting points for the graph walk.',
  }
}

export interface ExpandCypherArgs {
  seedIds: string[]
  hops: number
  types: RelType[]
  jurisdictions: string[] | null
  intent: Intent
  focalId: string | null
  focalLabel: string | null
}

const RETURN_RELS = 'UNWIND rs AS r\nWITH r WHERE r IS NOT NULL\nRETURN DISTINCT r'

/** The fixed graph pattern each intent reads its answer from, appended to the walk with UNION. */
function intentPattern(a: ExpandCypherArgs): string | null {
  const focal = 'MATCH (focal {id: $focalId})'
  switch (a.intent) {
    case 'ownership':
      return a.focalLabel === 'Person'
        ? `${focal}
MATCH p = (focal)-[:OWNS*1..6]->(:Company)
WITH relationships(p) AS rs
${RETURN_RELS}`
        : `${focal}
OPTIONAL MATCH (holder)-[:HOLDS]->(focal)
WITH coalesce(holder, focal) AS subject
MATCH p = (owner)-[:OWNS*1..6]->(subject)
WHERE NOT ()-[:OWNS]->(owner)
WITH relationships(p) AS rs
${RETURN_RELS}`
    case 'shared':
      return `${focal}
MATCH (focal)-[r1:REGISTERED_AT|USED_DEVICE|DIRECTOR_OF|HOLDS*1..2]-(via)<-[r2:REGISTERED_AT|USED_DEVICE|DIRECTOR_OF]-(other)
WHERE other <> focal AND (via:Address OR via:Device OR via:Person)
WITH r1 + [r2] AS rs
${RETURN_RELS}`
    case 'sanctions':
      return `${focal}
MATCH (e:SanctionsEntry)
MATCH p = shortestPath((focal)-[:${SANCTIONS_TYPES.join('|')}*..3]-(e))
WHERE none(m IN relationships(p) WHERE type(m) = 'MATCHES' AND m.disposition = 'false positive')
WITH relationships(p) AS rs
${RETURN_RELS}`
    case 'trail':
      return `${focal}
OPTIONAL MATCH (focal)-[h:HOLDS]->(held:Account)
WITH coalesce(held, focal) AS a, h
MATCH (a)-[r1:SENT|RECEIVED]->(t:Transaction)
OPTIONAL MATCH (b:Account)-[r2:SENT|RECEIVED]->(t) WHERE b <> a AND type(r2) <> type(r1)
OPTIONAL MATCH (holder)-[r3:HOLDS]->(b)
WITH t, [h, r1, r2, r3] AS rs
ORDER BY t.date
${RETURN_RELS}`
    case 'flagged':
      return `${focal}
OPTIONAL MATCH (focal)-[:HOLDS]->(held:Account)
WITH coalesce(held, focal) AS x
MATCH (x)-[:SENT|RECEIVED*0..1]->(t)<-[f:FLAGS]-(al:Alert)
OPTIONAL MATCH (payer:Account)-[s:SENT]->(t)
OPTIONAL MATCH (payee:Account)-[rc:RECEIVED]->(t)
WITH t, [f, s, rc] AS rs
ORDER BY t.date
${RETURN_RELS}`
    case 'regulation':
      return `${focal}
OPTIONAL MATCH (focal)-[i:INCORPORATED_IN]->(home:Jurisdiction)
MATCH (j:Jurisdiction)
WHERE ($jurisdictions IS NOT NULL AND j.jurisdiction IN $jurisdictions)
   OR ($jurisdictions IS NULL AND (j = home OR j = focal OR j.jurisdiction = focal.jurisdiction))
MATCH (j)-[g:GOVERNED_BY]->(:Regulation)
WITH [i, g] AS rs
${RETURN_RELS}`
    case 'profile':
      return null
  }
}

export function expandCypher(a: ExpandCypherArgs): CypherStep {
  const p: Record<string, unknown> = { seedIds: a.seedIds, hops: a.hops, jurisdictions: a.jurisdictions }
  const pattern = a.focalId ? intentPattern(a) : null
  if (pattern) p.focalId = a.focalId
  const walk = `MATCH (seed) WHERE seed.id IN $seedIds
CALL apoc.path.subgraphAll(seed, {maxLevel: $hops, relationshipFilter: '${a.types.join('|')}', labelFilter: '-Section|-Document'})
YIELD relationships
UNWIND relationships AS r
WITH r, startNode(r) AS a, endNode(r) AS b
WHERE $jurisdictions IS NULL
   OR all(n IN [a, b] WHERE n.id IN $seedIds OR n.jurisdiction IS NULL OR n.jurisdiction IN $jurisdictions)
RETURN DISTINCT r`
  return {
    stage: 'expand',
    query: `${params(p)}\n${walk}${pattern ? `\nUNION\n${pattern}` : ''}`,
    explain: `Walk up to ${a.hops} hop${a.hops === 1 ? '' : 's'} from the seeds along ${a.types.join(', ')}, never into Section or Document nodes${a.jurisdictions ? `, keeping to ${a.jurisdictions.join(', ')}` : ''}.${pattern ? ` The UNION adds the ${a.intent} pattern the answer is read from.` : ''}`,
  }
}

export function rankCypher(relIds: string[], dist: Record<string, number>): CypherStep {
  return {
    stage: 'rank',
    query: `${params({ relIds, dist })}
MATCH (a)-[r]->(b) WHERE r.id IN $relIds
WITH a, r, b, coalesce($dist[a.id], 99) AS da, coalesce($dist[b.id], 99) AS db
WITH a, r, b, CASE WHEN da < db THEN da ELSE db END AS d
RETURN r.id AS rel_id, a.name AS subject, type(r) AS relation, b.name AS object,
  r.confidence AS confidence, r.section_id AS section_id
ORDER BY r.confidence / (1.0 + d) DESC, r.id`,
    explain: 'Facts score confidence ÷ (1 + hops from the nearest seed): sure facts close to the question first.',
  }
}

export function passagesCypher(relIds: string[]): CypherStep {
  return {
    stage: 'passages',
    query: `${params({ relIds })}
MATCH ()-[r]->() WHERE r.id IN $relIds AND r.section_id IS NOT NULL
MATCH (s:Section {id: r.section_id})
MATCH (d:Document)-[:HAS_SECTION]->(s)
RETURN DISTINCT s.id AS id, s.title AS title, s.text AS text, d.id AS document_id, d.title AS document`,
    explain: 'Every extracted relationship records the section it came from; join to those sections to cite them.',
  }
}
