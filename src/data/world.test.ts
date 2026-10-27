import { loadWorld, type WorldIndex } from './load'
import {
  ALERTED_TXN,
  BENIGN_LOOKALIKES,
  COLLECTOR,
  FRONT_COMPANY,
  FRONT_DIRECTOR,
  MERIDIAN,
  MULE_ACCOUNTS,
} from './scenarios'
import type { GNode, GRel, NodeLabel, RelType } from '../domain/types'

const w: WorldIndex = loadWorld()
const DOC_LABELS: NodeLabel[] = ['Document', 'Section']
const entities = w.nodes.filter((n) => !DOC_LABELS.includes(n.label))
const node = (id: string): GNode => {
  const n = w.byId.get(id)
  if (!n) throw new Error(`missing node ${id}`)
  return n
}
const outOf = (id: string, type: RelType): GRel[] => (w.out.get(id) ?? []).filter((r) => r.type === type)
const inTo = (id: string, type: RelType): GRel[] => (w.in.get(id) ?? []).filter((r) => r.type === type)
const num = (v: unknown): number => (typeof v === 'number' ? v : NaN)

// Direction conventions every later task relies on: [type, from labels, to labels]
const SHAPES: [RelType, NodeLabel[], NodeLabel[]][] = [
  ['OWNS', ['Person', 'Company'], ['Company']],
  ['DIRECTOR_OF', ['Person'], ['Company']],
  ['CONTROLS', ['Person', 'Company'], ['Company']],
  ['HOLDS', ['Person', 'Company'], ['Account']],
  ['SENT', ['Account'], ['Transaction']],
  ['RECEIVED', ['Account'], ['Transaction']],
  ['REGISTERED_AT', ['Person', 'Company'], ['Address']],
  ['USED_DEVICE', ['Person', 'Account'], ['Device']],
  ['MATCHES', ['Person', 'Company'], ['SanctionsEntry']],
  ['INCORPORATED_IN', ['Company'], ['Jurisdiction']],
  ['GOVERNED_BY', ['Jurisdiction'], ['Regulation']],
  ['SUBJECT_OF', ['Person', 'Company', 'Account'], ['Case']],
  ['FLAGS', ['Alert'], ['Transaction']],
  ['HAS_SECTION', ['Document'], ['Section']],
]

// Character-bigram Dice similarity on single tokens, for "looks like a listed name".
const bigrams = (s: string) => {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}
const dice = (a: string, b: string) => {
  const A = bigrams(a)
  const B = bigrams(b)
  const pool = [...B]
  let hit = 0
  for (const g of A) {
    const i = pool.indexOf(g)
    if (i >= 0) {
      hit++
      pool.splice(i, 1)
    }
  }
  return (2 * hit) / (A.length + B.length)
}
const tokens = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 5)
const resembles = (a: string, b: string) => tokens(a).some((x) => tokens(b).some((y) => dice(x, y) >= 0.7))

describe('world dataset: structure', () => {
  it('has 150–300 entity nodes (excluding Document and Section)', () => {
    expect(entities.length).toBeGreaterThanOrEqual(150)
    expect(entities.length).toBeLessThanOrEqual(300)
  })

  it('has unique node and rel ids', () => {
    expect(new Set(w.nodes.map((n) => n.id)).size).toBe(w.nodes.length)
    expect(new Set(w.rels.map((r) => r.id)).size).toBe(w.rels.length)
  })

  it('every rel endpoint exists', () => {
    const bad = w.rels.filter((r) => !w.byId.has(r.from) || !w.byId.has(r.to))
    expect(bad).toEqual([])
  })

  it('every rel follows the direction conventions', () => {
    const shape = new Map(SHAPES.map(([t, f, to]) => [t, { f, to }]))
    const bad = w.rels.filter((r) => {
      const s = shape.get(r.type)!
      return !s.f.includes(node(r.from).label) || !s.to.includes(node(r.to).label)
    })
    expect(bad.map((r) => `${r.type} ${node(r.from).label}->${node(r.to).label}`)).toEqual([])
  })

  it('every extracted rel has 0<confidence<=1 and an existing section_id', () => {
    for (const r of w.rels) {
      expect(r.confidence, r.id).toBeGreaterThan(0)
      expect(r.confidence, r.id).toBeLessThanOrEqual(1)
      if (r.type === 'HAS_SECTION') continue
      expect(r.section_id, r.id).not.toBeNull()
      expect(w.sectionById.has(r.section_id!), `${r.id} -> ${r.section_id}`).toBe(true)
    }
  })

  it('documents and sections are graph nodes wired by HAS_SECTION', () => {
    for (const d of w.documents) expect(node(d.id).label).toBe('Document')
    for (const s of w.sections) {
      expect(node(s.id).label).toBe('Section')
      const parent = inTo(s.id, 'HAS_SECTION')
      expect(parent.map((r) => r.from)).toEqual([s.document_id])
      const sentences = s.text.split(/(?<=[.!?])\s+/).filter(Boolean)
      expect(sentences.length, s.id).toBeGreaterThanOrEqual(2)
      expect(sentences.length, s.id).toBeLessThanOrEqual(5)
    }
    const kinds = new Set(w.documents.map((d) => d.kind))
    expect([...kinds].sort()).toEqual(['case-note', 'kyc', 'registry', 'regulation', 'sanctions', 'sar'])
  })

  it('OWNS has numeric props.pct in (0,100]', () => {
    const owns = w.rels.filter((r) => r.type === 'OWNS')
    expect(owns.length).toBeGreaterThan(20)
    for (const r of owns) {
      expect(typeof r.props.pct, r.id).toBe('number')
      expect(r.props.pct as number).toBeGreaterThan(0)
      expect(r.props.pct as number).toBeLessThanOrEqual(100)
    }
    // no company is more than 100% owned
    for (const c of entities.filter((n) => n.label === 'Company')) {
      const total = inTo(c.id, 'OWNS').reduce((s, r) => s + num(r.props.pct), 0)
      expect(total, c.name).toBeLessThanOrEqual(100)
    }
  })

  it('covers US, UK, EU and one offshore jurisdiction', () => {
    const codes = entities.filter((n) => n.label === 'Jurisdiction').map((n) => n.jurisdiction)
    expect(codes).toEqual(expect.arrayContaining(['US', 'UK', 'EU']))
    const offshore = entities.filter((n) => n.label === 'Jurisdiction' && n.props.offshore === true)
    expect(offshore.length).toBeGreaterThanOrEqual(1)
    // every entity's jurisdiction code refers to a Jurisdiction node
    const known = new Set(codes)
    for (const n of entities) if (n.jurisdiction) expect(known.has(n.jurisdiction), n.id).toBe(true)
    // every company is incorporated in exactly its own jurisdiction
    for (const c of entities.filter((n) => n.label === 'Company')) {
      const inc = outOf(c.id, 'INCORPORATED_IN')
      expect(inc.length, c.name).toBe(1)
      expect(node(inc[0].to).jurisdiction, c.name).toBe(c.jurisdiction)
    }
  })

  it('every entity has a neighbourhood and a name', () => {
    for (const n of entities) {
      expect(n.name.trim().length, n.id).toBeGreaterThan(0)
      const degree = (w.out.get(n.id)?.length ?? 0) + (w.in.get(n.id)?.length ?? 0)
      expect(degree, n.id).toBeGreaterThan(0)
    }
    const ordinary = entities.filter((n) => n.label === 'Company' && (w.out.get(n.id)?.length ?? 0) + (w.in.get(n.id)?.length ?? 0) >= 4)
    expect(ordinary.length).toBeGreaterThanOrEqual(25)
  })

  it('every Alert FLAGS a Transaction and has rule, reason, threshold', () => {
    const alerts = entities.filter((n) => n.label === 'Alert')
    expect(alerts.length).toBeGreaterThanOrEqual(5)
    for (const a of alerts) {
      const flags = outOf(a.id, 'FLAGS')
      expect(flags.length, a.id).toBeGreaterThanOrEqual(1)
      for (const f of flags) expect(node(f.to).label).toBe('Transaction')
      expect(typeof a.props.rule).toBe('string')
      expect(typeof a.props.reason).toBe('string')
      expect(typeof a.props.threshold).toBe('number')
    }
  })

  it('transactions carry amount, currency, ISO date and a sender or receiver', () => {
    for (const t of entities.filter((n) => n.label === 'Transaction')) {
      expect(num(t.props.amount), t.id).toBeGreaterThan(0)
      expect(t.props.currency).toMatch(/^[A-Z]{3}$/)
      expect(t.props.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(inTo(t.id, 'RECEIVED').length + inTo(t.id, 'SENT').length, t.id).toBeGreaterThan(0)
    }
  })
})

describe('world dataset: scenarios', () => {
  it('scenario: layered ownership', () => {
    const m = node(MERIDIAN)
    expect(m.name).toBe('Meridian Trade LLC')
    // walk OWNS backwards (owner -> owned) from Meridian to a Person
    type Path = string[]
    const found: Path[] = []
    const walk = (id: string, path: Path) => {
      for (const r of inTo(id, 'OWNS')) {
        if (path.includes(r.from)) continue
        const next = [...path, r.from]
        if (node(r.from).label === 'Person') found.push(next)
        else walk(r.from, next)
      }
    }
    walk(MERIDIAN, [MERIDIAN])
    const layered = found.filter((p) => {
      const hops = p.length - 1
      const jur = new Set(p.slice(0, -1).map((id) => node(id).jurisdiction))
      return hops >= 3 && jur.size >= 3
    })
    expect(layered.length).toBeGreaterThanOrEqual(1)
  })

  it('scenario: sanctions front', () => {
    const strongMatch = (id: string) => outOf(id, 'MATCHES').some((r) => num(r.props.score) >= 0.8)
    const fronts = entities.filter((c) => {
      if (c.label !== 'Company') return false
      const dirHit = inTo(c.id, 'DIRECTOR_OF').some((r) => strongMatch(r.from))
      const addrs = outOf(c.id, 'REGISTERED_AT').map((r) => r.to)
      const listedNeighbour = addrs.some((a) => inTo(a, 'REGISTERED_AT').some((r) => r.from !== c.id && strongMatch(r.from)))
      return dirHit && listedNeighbour
    })
    expect(fronts.map((c) => c.id)).toContain(FRONT_COMPANY)
    expect(inTo(FRONT_COMPANY, 'DIRECTOR_OF').map((r) => r.from)).toContain(FRONT_DIRECTOR)
    expect(strongMatch(FRONT_DIRECTOR)).toBe(true)
  })

  it('scenario: mule ring', () => {
    expect(MULE_ACCOUNTS.length).toBeGreaterThanOrEqual(4)
    const linked = (acc: string) => {
      const holders = inTo(acc, 'HOLDS').map((r) => r.from)
      return new Set(
        [acc, ...holders].flatMap((id) => [...outOf(id, 'USED_DEVICE'), ...outOf(id, 'REGISTERED_AT')].map((r) => r.to)),
      )
    }
    const counts = new Map<string, number>()
    for (const a of MULE_ACCOUNTS) for (const x of linked(a)) counts.set(x, (counts.get(x) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(4)

    for (const a of MULE_ACCOUNTS) {
      expect(node(a).label).toBe('Account')
      const structured = outOf(a, 'RECEIVED').filter((r) => {
        const amt = num(node(r.to).props.amount)
        return amt >= 9000 && amt <= 9999
      })
      expect(structured.length, a).toBeGreaterThanOrEqual(2)
      const toCollector = outOf(a, 'SENT').some((r) => inTo(r.to, 'RECEIVED').some((x) => x.from === COLLECTOR))
      expect(toCollector, a).toBe(true)
    }
    expect(MULE_ACCOUNTS).not.toContain(COLLECTOR)
  })

  it('scenario: benign look-alike', () => {
    const listed = entities.filter((n) => n.label === 'SanctionsEntry')
    const listedNames = listed.flatMap((s) => [s.name, ...(s.aliases ?? [])])
    expect(BENIGN_LOOKALIKES.length).toBeGreaterThanOrEqual(2)
    for (const id of BENIGN_LOOKALIKES) {
      const n = node(id)
      expect(listedNames.some((l) => resembles(n.name, l)), n.name).toBe(true)
      expect(outOf(id, 'MATCHES').filter((r) => num(r.props.score) >= 0.5)).toEqual([])
    }
  })

  it('the alerted transaction is the 14 March 2026 wire', () => {
    const t = node(ALERTED_TXN)
    expect(t.props.date).toBe('2026-03-14')
    expect(t.props.channel).toBe('wire')
    expect(inTo(ALERTED_TXN, 'FLAGS').length).toBeGreaterThanOrEqual(1)
  })
})

describe('loadWorld', () => {
  it('memoises and indexes every rel both ways', () => {
    expect(loadWorld()).toBe(w)
    const outCount = [...w.out.values()].reduce((s, l) => s + l.length, 0)
    const inCount = [...w.in.values()].reduce((s, l) => s + l.length, 0)
    expect(outCount).toBe(w.rels.length)
    expect(inCount).toBe(w.rels.length)
    expect(w.byId.size).toBe(w.nodes.length)
    expect(w.sectionById.size).toBe(w.sections.length)
  })
})
