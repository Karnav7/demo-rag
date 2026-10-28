import type { GNode, GRel, Mode, NodeLabel, RelType } from '../domain/types'
import type { WorldIndex } from '../data/load'
import type { Expansion } from './expand'
import { tokenize } from './lexical'

export type Intent = 'ownership' | 'shared' | 'sanctions' | 'trail' | 'flagged' | 'regulation' | 'profile'

/** First matching rule wins, so the more specific intents come first. */
const RULES: [Intent, RegExp][] = [
  ['sanctions', /\bsanction|\b(?:watch ?lists?|blacklist(?:ed)?|designated|listed (?:party|parties|entity|entities|person)|ofac|embargo(?:ed)?|screening)\b/i],
  ['flagged', /\b(?:flag(?:s|ged)?|alert(?:s|ed)?|trigger(?:s|ed)?)\b/i],
  ['regulation', /\b(?:regulations?|regulat\w*|laws?|legal|rules?|requires?|required|requirements?|reporting|obligations?|comply|compliance|amld|mlrs?|cdd|bsa|poca)\b/i],
  ['shared', /\b(?:shares?|sharing|shared|same (?:address|device|director|phone)|in common|who else|co-located)\b/i],
  ['ownership', /\b(?:own(?:s|ed|er|ers|ership)?|ubo|beneficial|control(?:s|led|ler|lers)?|directors?|shareholders?|behind|parent)\b/i],
  ['trail', /\b(?:trail|flows?|transactions?|payments?|transfers?|wires?|sent|received|funds|money|deposits?|counterpart(?:y|ies)|paid)\b/i],
]

export function classify(q: string): Intent {
  for (const [intent, re] of RULES) if (re.test(q)) return intent
  return 'profile'
}

/** Whether a single word is part of an intent's wording ("money", "trail", "directors"). */
export function isIntentWord(token: string): boolean {
  return RULES.some(([, re]) => re.test(token))
}

export const ALL_TYPES: RelType[] = ['OWNS', 'DIRECTOR_OF', 'CONTROLS', 'HOLDS', 'SENT', 'RECEIVED', 'REGISTERED_AT', 'USED_DEVICE', 'MATCHES', 'INCORPORATED_IN', 'GOVERNED_BY', 'SUBJECT_OF', 'FLAGS']

/**
 * Sanctions exposure walks "any type", minus the hub relationships: every UK company is INCORPORATED_IN the
 * same Jurisdiction node and case files group unrelated subjects, so walking those would put every entity
 * three hops from a listed party.
 */
export const SANCTIONS_TYPES: RelType[] = ['OWNS', 'DIRECTOR_OF', 'CONTROLS', 'HOLDS', 'SENT', 'RECEIVED', 'REGISTERED_AT', 'USED_DEVICE', 'MATCHES']

export interface IntentSpec {
  types: RelType[]
  /** Fixed hop count; when absent the mode decides (graph: 3, otherwise 1). */
  hops?: number
  /** Seed labels that can be the focal entity, in no particular order. */
  focus: NodeLabel[] | null
  /** What the answer is about, for the "no facts" fallback ("The graph holds no …"). */
  about: string
}

export const INTENTS: Record<Intent, IntentSpec> = {
  ownership: { types: ['OWNS', 'CONTROLS', 'DIRECTOR_OF'], focus: ['Company', 'Person', 'Account'], about: 'ownership or control records' },
  shared: { types: ['REGISTERED_AT', 'USED_DEVICE', 'DIRECTOR_OF'], focus: ['Company', 'Person', 'Account', 'Address', 'Device'], about: 'shared addresses, devices or directors' },
  sanctions: { types: SANCTIONS_TYPES, hops: 3, focus: ['Company', 'Person', 'Account', 'Transaction', 'Address', 'Device'], about: 'sanctions links' },
  trail: { types: ['HOLDS', 'SENT', 'RECEIVED'], focus: ['Account', 'Company', 'Person', 'Transaction'], about: 'transactions' },
  flagged: { types: ['FLAGS', 'SENT', 'RECEIVED'], focus: ['Transaction', 'Account', 'Company', 'Person', 'Alert'], about: 'monitoring alerts' },
  regulation: { types: ['GOVERNED_BY', 'INCORPORATED_IN'], focus: null, about: 'applicable regulations' },
  profile: { types: ALL_TYPES, hops: 1, focus: null, about: 'relationships' },
}

export function hopsFor(intent: Intent, mode: Mode): number {
  return INTENTS[intent].hops ?? (mode === 'graph' ? 3 : 1)
}

/** The seed the answer is about: the best-ranked seed whose label suits the intent. */
export function pickFocal(w: WorldIndex, intent: Intent, seeds: string[]): GNode | null {
  const nodes = seeds.map((id) => w.byId.get(id)).filter((n): n is GNode => !!n)
  const focus = INTENTS[intent].focus
  return (focus && nodes.find((n) => focus.includes(n.label))) || nodes[0] || null
}

// ---------------------------------------------------------------------------------------------
// Intent patterns. Each one is a fixed graph pattern around the focal entity (shown as the UNION
// part of the expand step's Cypher). Its relationships are merged into the evidence.

export interface Chain { owner: GNode; pct: number; paths: GRel[][] }
export interface Holding { company: GNode; pct: number; path: GRel[] }
export interface Party { account: GNode; rel: GRel; holder?: GNode; holderRel?: GRel }
export interface TrailItem { txn: GNode; account: GNode; dir: 'in' | 'out'; rel: GRel; counter?: Party }
export interface SharedOther { node: GNode; rels: GRel[]; listed?: GRel }
export interface SharedGroup { kind: 'address' | 'device' | 'director'; via: GNode; link: GRel[]; others: SharedOther[] }
export interface SanctionsHit { entry: GNode; path: GRel[]; nodes: GNode[]; match: GRel }
export interface FlaggedItem { target: GNode; alerts: { alert: GNode; rel: GRel }[]; payer?: Party; payee?: Party }
export interface RegulationItem { jur: GNode; via?: GRel; regs: { reg: GNode; rel: GRel; section: string | null; score: number }[] }

export type Match =
  | { intent: 'ownership'; focal: GNode; subject: GNode; holderRel?: GRel; owners: Chain[]; holdings: Holding[]; control: GRel[]; directors: GRel[]; directorships: GRel[]; rels: GRel[] }
  | { intent: 'shared'; focal: GNode; groups: SharedGroup[]; rels: GRel[] }
  | { intent: 'sanctions'; focal: GNode; hits: SanctionsHit[]; cleared: GRel[]; ties: GRel[]; checked: number; hops: number; rels: GRel[] }
  | { intent: 'trail'; focal: GNode; accounts: GNode[]; holders: Map<string, GRel>; items: TrailItem[]; rels: GRel[] }
  | { intent: 'flagged'; focal: GNode; items: FlaggedItem[]; rels: GRel[] }
  | { intent: 'regulation'; focal: GNode; items: RegulationItem[]; rels: GRel[] }
  | { intent: 'profile'; focal: GNode; rels: GRel[] }

const byRelId = (a: GRel, b: GRel) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const ins = (w: WorldIndex, id: string, type: RelType) => (w.in.get(id) ?? []).filter((r) => r.type === type).sort(byRelId)
const outs = (w: WorldIndex, id: string, type: RelType) => (w.out.get(id) ?? []).filter((r) => r.type === type).sort(byRelId)
const node = (w: WorldIndex, id: string) => w.byId.get(id)!

export const isCleared = (r: GRel) => r.type === 'MATCHES' && String(r.props.disposition ?? '').toLowerCase() === 'false positive'

function uniqRels(rels: (GRel | undefined)[]): GRel[] {
  const m = new Map<string, GRel>()
  for (const r of rels) if (r) m.set(r.id, r)
  return [...m.values()].sort(byRelId)
}

function holderOf(w: WorldIndex, accountId: string): { holder?: GNode; holderRel?: GRel } {
  const r = ins(w, accountId, 'HOLDS')[0]
  return r ? { holder: node(w, r.from), holderRel: r } : {}
}

function party(w: WorldIndex, rel: GRel | undefined): Party | undefined {
  if (!rel) return undefined
  return { account: node(w, rel.from), rel, ...holderOf(w, rel.from) }
}

function partyRels(p?: Party): (GRel | undefined)[] {
  return p ? [p.rel, p.holderRel] : []
}

const MAX_CHAIN = 6

function ownership(w: WorldIndex, focal: GNode): Match {
  let subject = focal
  let holderRel: GRel | undefined
  if (focal.label === 'Account') {
    holderRel = ins(w, focal.id, 'HOLDS')[0]
    if (holderRel) subject = node(w, holderRel.from)
  }
  // Walk OWNS upwards; every maximal path ends at an ultimate owner.
  const found = new Map<string, Chain>()
  const up = (id: string, pct: number, path: GRel[], seen: Set<string>) => {
    const owners = ins(w, id, 'OWNS').filter((r) => !seen.has(r.from))
    if (!owners.length || path.length >= MAX_CHAIN) {
      if (!path.length) return
      const c = found.get(id) ?? { owner: node(w, id), pct: 0, paths: [] }
      c.pct += pct
      c.paths.push(path)
      found.set(id, c)
      return
    }
    for (const r of owners) up(r.from, pct * pctOf(r), [...path, r], new Set([...seen, r.from]))
  }
  up(subject.id, 1, [], new Set([subject.id]))
  const owners = [...found.values()].sort(
    (a, b) => b.pct - a.pct || Number(b.owner.label === 'Person') - Number(a.owner.label === 'Person') || a.owner.name.localeCompare(b.owner.name),
  )
  // A person's holdings: walk OWNS downwards.
  const holdings: Holding[] = []
  if (subject.label === 'Person') {
    const down = (id: string, pct: number, path: GRel[], seen: Set<string>) => {
      for (const r of outs(w, id, 'OWNS')) {
        if (seen.has(r.to) || path.length >= MAX_CHAIN) continue
        const p = pct * pctOf(r)
        holdings.push({ company: node(w, r.to), pct: p, path: [...path, r] })
        down(r.to, p, [...path, r], new Set([...seen, r.to]))
      }
    }
    down(subject.id, 1, [], new Set([subject.id]))
  }
  const control = [...ins(w, subject.id, 'CONTROLS'), ...(subject.label === 'Person' ? outs(w, subject.id, 'CONTROLS') : [])]
  const directors = ins(w, subject.id, 'DIRECTOR_OF')
  const directorships = subject.label === 'Person' ? outs(w, subject.id, 'DIRECTOR_OF') : []
  const rels = uniqRels([holderRel, ...owners.flatMap((o) => o.paths.flat()), ...holdings.flatMap((h) => h.path), ...control, ...directors, ...directorships])
  return { intent: 'ownership', focal, subject, holderRel, owners, holdings, control, directors, directorships, rels }
}

export function pctOf(r: GRel): number {
  const p = Number(r.props.pct)
  return Number.isFinite(p) ? p / 100 : 1
}

function listedMatch(w: WorldIndex, id: string): GRel | undefined {
  return outs(w, id, 'MATCHES').find((r) => !isCleared(r))
}

function shared(w: WorldIndex, focal: GNode): Match {
  const groups: SharedGroup[] = []
  const other = (id: string, rels: (GRel | undefined)[]): SharedOther => {
    const listed = listedMatch(w, id)
    return { node: node(w, id), rels: rels.filter((r): r is GRel => !!r), listed }
  }
  if (focal.label === 'Address' || focal.label === 'Device') {
    const type = focal.label === 'Address' ? 'REGISTERED_AT' : 'USED_DEVICE'
    const others = ins(w, focal.id, type).map((r) => {
      const h = focal.label === 'Device' ? holderOf(w, r.from) : {}
      return other(r.from, [r, h.holderRel])
    })
    groups.push({ kind: focal.label === 'Address' ? 'address' : 'device', via: focal, link: [], others })
  } else {
    for (const r of outs(w, focal.id, 'REGISTERED_AT')) {
      const others = ins(w, r.to, 'REGISTERED_AT').filter((x) => x.from !== focal.id).map((x) => other(x.from, [x]))
      groups.push({ kind: 'address', via: node(w, r.to), link: [r], others })
    }
    const accounts = focal.label === 'Account' ? [{ id: focal.id, rel: undefined as GRel | undefined }] : outs(w, focal.id, 'HOLDS').map((r) => ({ id: r.to, rel: r as GRel | undefined }))
    const own = new Set(accounts.map((a) => a.id))
    for (const a of accounts) {
      for (const u of outs(w, a.id, 'USED_DEVICE')) {
        const others = ins(w, u.to, 'USED_DEVICE')
          .filter((x) => !own.has(x.from))
          .map((x) => other(x.from, [x, holderOf(w, x.from).holderRel]))
        groups.push({ kind: 'device', via: node(w, u.to), link: [a.rel, u].filter((x): x is GRel => !!x), others })
      }
    }
    if (focal.label === 'Company') {
      for (const d of ins(w, focal.id, 'DIRECTOR_OF')) {
        const others = outs(w, d.from, 'DIRECTOR_OF').filter((x) => x.to !== focal.id).map((x) => other(x.to, [x]))
        groups.push({ kind: 'director', via: node(w, d.from), link: [d], others })
      }
    }
  }
  const rels = uniqRels(groups.flatMap((g) => [...g.link, ...g.others.flatMap((o) => [...o.rels, o.listed])]))
  return { intent: 'shared', focal, groups, rels }
}

/** Shortest path (BFS over the expansion) from the focal entity to each sanctions entry; cleared matches don't count. */
function sanctions(w: WorldIndex, focal: GNode, exp: Expansion, hops: number): Match {
  const adj = new Map<string, GRel[]>()
  for (const r of exp.rels) {
    if (isCleared(r)) continue
    for (const id of [r.from, r.to]) adj.set(id, [...(adj.get(id) ?? []), r])
  }
  const prev = new Map<string, GRel | null>([[focal.id, null]])
  let frontier = [focal.id]
  for (let d = 0; d < hops && frontier.length; d++) {
    const next: string[] = []
    for (const id of frontier) {
      if (id !== focal.id && node(w, id).label === 'SanctionsEntry') continue
      for (const r of adj.get(id) ?? []) {
        const o = r.from === id ? r.to : r.from
        if (prev.has(o)) continue
        prev.set(o, r)
        next.push(o)
      }
    }
    frontier = next
  }
  const hits: SanctionsHit[] = []
  for (const id of prev.keys()) {
    const entry = node(w, id)
    if (entry.label !== 'SanctionsEntry') continue
    const path: GRel[] = []
    const nodes: GNode[] = [entry]
    let cur = id
    while (prev.get(cur)) {
      const r = prev.get(cur)!
      path.unshift(r)
      cur = r.from === cur ? r.to : r.from
      nodes.unshift(node(w, cur))
    }
    hits.push({ entry, path, nodes, match: path[path.length - 1] })
  }
  hits.sort((a, b) => a.path.length - b.path.length || Number(b.match.props.score ?? 0) - Number(a.match.props.score ?? 0) || a.entry.id.localeCompare(b.entry.id))
  // Cleared screening hits on the focal entity or its direct ties; further out they are someone else's story.
  const cleared = exp.rels.filter((r) => isCleared(r) && (exp.dist.get(r.from) ?? 99) <= 1)
  // For a "no" answer: the focal entity's own strongest ties, to show what was checked.
  const ties = exp.rels
    .filter((r) => (r.from === focal.id || r.to === focal.id) && r.type !== 'MATCHES')
    .sort((a, b) => b.confidence - a.confidence || byRelId(a, b))
    .slice(0, 4)
  const rels = uniqRels([...hits.flatMap((h) => h.path), ...cleared, ...(hits.length ? [] : ties)])
  return { intent: 'sanctions', focal, hits, cleared, ties, checked: exp.nodeIds.size - 1, hops, rels }
}

const dateOf = (n: GNode) => String(n.props.date ?? '')

function trail(w: WorldIndex, focal: GNode): Match {
  const holders = new Map<string, GRel>()
  const items: TrailItem[] = []
  let accounts: GNode[] = []
  if (focal.label === 'Transaction') {
    const sent = ins(w, focal.id, 'SENT')[0]
    const recv = ins(w, focal.id, 'RECEIVED')[0]
    if (sent) items.push({ txn: focal, account: node(w, sent.from), dir: 'out', rel: sent, counter: party(w, recv) })
    if (sent) {
      const h = holderOf(w, sent.from)
      if (h.holderRel) holders.set(sent.from, h.holderRel)
      accounts = [node(w, sent.from)]
    }
  } else {
    if (focal.label === 'Account') {
      accounts = [focal]
      const h = holderOf(w, focal.id)
      if (h.holderRel) holders.set(focal.id, h.holderRel)
    } else {
      for (const r of outs(w, focal.id, 'HOLDS')) {
        accounts.push(node(w, r.to))
        holders.set(r.to, r)
      }
    }
    const own = new Set(accounts.map((a) => a.id))
    for (const a of accounts) {
      for (const r of [...outs(w, a.id, 'SENT'), ...outs(w, a.id, 'RECEIVED')]) {
        const txn = node(w, r.to)
        const dir = r.type === 'SENT' ? 'out' : 'in'
        const other = ins(w, txn.id, dir === 'out' ? 'RECEIVED' : 'SENT').find((x) => !own.has(x.from))
        items.push({ txn, account: a, dir, rel: r, counter: party(w, other) })
      }
    }
  }
  items.sort((a, b) => dateOf(a.txn).localeCompare(dateOf(b.txn)) || a.txn.id.localeCompare(b.txn.id))
  const rels = uniqRels([...holders.values(), ...items.flatMap((i) => [i.rel, ...partyRels(i.counter)])])
  return { intent: 'trail', focal, accounts, holders, items, rels }
}

function flagged(w: WorldIndex, focal: GNode): Match {
  let targets: GNode[] = []
  if (focal.label === 'Alert') targets = outs(w, focal.id, 'FLAGS').map((r) => node(w, r.to))
  else if (focal.label === 'Transaction') targets = [focal]
  else {
    const accounts = focal.label === 'Account' ? [focal.id] : outs(w, focal.id, 'HOLDS').map((r) => r.to)
    const seen = new Set<string>()
    for (const a of accounts) {
      if (!seen.has(a)) targets.push(node(w, a))
      seen.add(a)
      for (const r of [...outs(w, a, 'SENT'), ...outs(w, a, 'RECEIVED')]) {
        if (!seen.has(r.to)) targets.push(node(w, r.to))
        seen.add(r.to)
      }
    }
  }
  const items: FlaggedItem[] = []
  for (const t of targets) {
    const alerts = ins(w, t.id, 'FLAGS').map((rel) => ({ alert: node(w, rel.from), rel }))
    if (!alerts.length) continue
    const item: FlaggedItem = { target: t, alerts }
    if (t.label === 'Transaction') {
      item.payer = party(w, ins(w, t.id, 'SENT')[0])
      item.payee = party(w, ins(w, t.id, 'RECEIVED')[0])
    }
    items.push(item)
  }
  items.sort((a, b) => dateOf(a.target).localeCompare(dateOf(b.target)) || a.target.id.localeCompare(b.target.id))
  const rels = uniqRels(items.flatMap((i) => [...i.alerts.map((a) => a.rel), ...partyRels(i.payer), ...partyRels(i.payee)]))
  return { intent: 'flagged', focal, items, rels }
}

/** Crude stemming so "reporting" meets "report" and "suspicious" meets "suspicion". */
const stem = (t: string) => t.replace(/(?:ing|ion|ions|ious|ed|es|s)$/, '')
const stems = (text: string) => new Set(tokenize(text).map(stem))

function regulation(w: WorldIndex, focal: GNode, question: string, named: string[] | null): Match {
  const jurs = w.nodes.filter((n) => n.label === 'Jurisdiction')
  const items: RegulationItem[] = []
  const add = (jur: GNode | undefined, via?: GRel) => {
    if (!jur || items.some((i) => i.jur.id === jur.id)) return
    items.push({ jur, via, regs: [] })
  }
  if (named) for (const code of named) add(jurs.find((j) => j.jurisdiction === code))
  else if (focal.label === 'Jurisdiction') add(focal)
  else if (focal.label === 'Regulation') {
    const g = ins(w, focal.id, 'GOVERNED_BY')[0]
    if (g) add(node(w, g.from))
  } else {
    const inc = outs(w, focal.id, 'INCORPORATED_IN')[0]
    if (inc) add(node(w, inc.to), inc)
    else add(jurs.find((j) => j.jurisdiction === focal.jurisdiction))
  }
  const q = stems(question)
  for (const item of items) {
    for (const rel of outs(w, item.jur.id, 'GOVERNED_BY')) {
      const reg = node(w, rel.to)
      if (focal.label === 'Regulation' && reg.id !== focal.id && !named) continue
      // The regulation's most relevant section, by stemmed word overlap with the question.
      const sections = w.sections.filter((s) => s.document_id === reg.props.document_id)
      let best: string | null = rel.section_id
      let bestScore = 0
      for (const s of sections) {
        const st = stems(`${s.title} ${s.text}`)
        const score = [...q].filter((t) => st.has(t)).length
        if (score > bestScore) [best, bestScore] = [s.id, score]
      }
      item.regs.push({ reg, rel, section: best, score: bestScore })
    }
    item.regs.sort((a, b) => b.score - a.score || a.rel.id.localeCompare(b.rel.id))
  }
  const rels = uniqRels(items.flatMap((i) => [i.via, ...i.regs.map((r) => r.rel)]))
  return { intent: 'regulation', focal, items, rels }
}

export function matchIntent(w: WorldIndex, intent: Intent, focal: GNode, exp: Expansion, question: string, named: string[] | null): Match {
  switch (intent) {
    case 'ownership': return ownership(w, focal)
    case 'shared': return shared(w, focal)
    case 'sanctions': return sanctions(w, focal, exp, INTENTS.sanctions.hops!)
    case 'trail': return trail(w, focal)
    case 'flagged': return flagged(w, focal)
    case 'regulation': return regulation(w, focal, question, named)
    case 'profile': return { intent: 'profile', focal, rels: exp.rels.filter((r) => r.from === focal.id || r.to === focal.id) }
  }
}
