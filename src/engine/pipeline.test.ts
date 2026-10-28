import { describe, expect, it } from 'vitest'
import { loadWorld } from '../data/load'
import * as S from '../data/scenarios'
import { ALERTED_TXN, BENIGN_LOOKALIKES, COLLECTOR, FRONT_COMPANY, FRONT_DIRECTOR, MERIDIAN, UBO } from '../data/scenarios'
import type { ChatRequest, ChatResponse, Mode, Settings } from '../domain/types'
import { resolveContext } from './context'
import { classify } from './intents'
import { runPipeline } from './pipeline'
import { starterQuestions } from '../ui/chat/suggestions'

const w = loadWorld()
const DEFAULTS: Settings = { source: 'offline', mode: 'hybrid', useContext: true, generateAnswer: true }
const name = (id: string) => w.byId.get(id)!.name

function ask(question: string, settings: Partial<Settings> = {}, history: ChatRequest['history'] = []) {
  return runPipeline(w, { question, history, settings: { ...DEFAULTS, ...settings } })
}

function citedNumbers(r: ChatResponse): number[] {
  return [...r.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))
}

describe('runPipeline', () => {
  it('ownership: names the seeded UBO and every [n] maps to an existing section', () => {
    const { response: r } = ask(`Who ultimately owns ${S.MERIDIAN_NAME}?`)
    expect(r.answer).toContain(name(UBO))
    expect(r.answer).toContain('75%')
    const ns = citedNumbers(r)
    expect(ns.length).toBeGreaterThan(0)
    for (const n of ns) {
      const c = r.citations.find((x) => x.n === n)
      expect(c, `citation [${n}]`).toBeDefined()
      expect(w.sectionById.has(c!.section_id)).toBe(true)
    }
    expect(r.sources.map((s) => s.id)).toEqual(r.citations.map((c) => c.section_id))
    expect(r.facts.some((f) => f.used)).toBe(true)
    expect(r.subgraph.nodes.find((n) => n.id === MERIDIAN)?.seed).toBe(true)
  })

  it('sanctions positive: the front company answer gives the match score and reaches a SanctionsEntry', () => {
    const { response: r } = ask(`Is ${name(FRONT_COMPANY)} connected to a sanctioned party?`)
    const match = w.out.get(FRONT_DIRECTOR)!.find((x) => x.type === 'MATCHES')!
    expect(r.answer).toContain(String(match.props.score))
    expect(r.subgraph.nodes.some((n) => n.label === 'SanctionsEntry')).toBe(true)
  })

  it.each([...BENIGN_LOOKALIKES])('sanctions negative: benign look-alike %s has no sanctions connection', (id) => {
    const { response: r } = ask(`Is ${name(id)} connected to a sanctioned party?`)
    expect(r.answer).toMatch(/no sanctions connection was found/i)
  })

  it('trail: the collector account facts include at least 4 RECEIVED rels', () => {
    const { response: r } = ask(`Show the money trail for account ${name(COLLECTOR)}`)
    expect(r.facts.filter((f) => f.relation === 'RECEIVED').length).toBeGreaterThanOrEqual(4)
  })

  it('flagged: the alerted transaction answer gives each alert rule and threshold', () => {
    const { response: r } = ask('Why was the 14 March wire flagged?')
    const alerts = (w.in.get(ALERTED_TXN) ?? []).filter((x) => x.type === 'FLAGS').map((x) => w.byId.get(x.from)!)
    expect(alerts.length).toBeGreaterThan(0)
    for (const a of alerts) {
      expect(r.answer).toContain(String(a.props.rule))
      expect(r.answer).toContain(Number(a.props.threshold).toLocaleString('en-GB'))
    }
  })

  it('unseeded question: a company outside the scenarios still gets facts', () => {
    const scenarioIds = new Set(Object.values(S).flatMap((v) => (Array.isArray(v) ? v : [v])))
    const company = w.nodes.find((n) => n.label === 'Company' && !scenarioIds.has(n.id))!
    const { response: r } = ask(`Tell me about ${company.name}`)
    expect(r.facts.length).toBeGreaterThan(0)
    expect(r.answer).not.toContain('No matching')
    expect(r.answer).toContain(company.name)
  })

  it.each<Mode>(['hybrid', 'lexical', 'vector', 'graph'])('no entities (%s): answers exactly "No matching facts in the graph."', (mode) => {
    const { response: r } = ask("What's the weather in Paris?", { mode })
    expect(r.answer).toBe('No matching facts in the graph.')
    expect(r.facts).toEqual([])
    expect(r.subgraph.nodes).toEqual([])
    expect(r.confidence).toBe(0)
  })

  const MODES: Mode[] = ['hybrid', 'lexical', 'vector', 'graph']
  const NEGATIVES = ['hello', 'Is there any company in Delaware?', 'Tell me about Elon Musk', 'list all persons']
  it.each(MODES.flatMap((mode) => NEGATIVES.map((q) => [mode, q] as const)))('no entity named (%s): "%s" gets "No matching facts in the graph."', (mode, q) => {
    const { response: r } = ask(q, { mode })
    expect(r.answer).toBe('No matching facts in the graph.')
    expect(r.facts).toEqual([])
    expect(r.subgraph.nodes).toEqual([])
    expect(r.confidence).toBe(0)
  })

  it.each(MODES.flatMap((mode) => starterQuestions(w).map((q) => [mode, q] as const)))('starter chip answers (%s): %s', (mode, q) => {
    const { response: r } = ask(q, { mode })
    expect(r.answer).not.toContain('No matching')
    expect(r.citations.length).toBeGreaterThan(0)
    expect(r.confidence).toBeGreaterThan(0)
  })

  it.each(MODES)('the wire chip is about the 14 March wire and its alerts (%s)', (mode) => {
    const { response: r } = ask(starterQuestions(w)[2], { mode })
    expect(r.subgraph.nodes.find((n) => n.id === ALERTED_TXN)?.seed).toBe(true)
    for (const x of (w.in.get(ALERTED_TXN) ?? []).filter((x) => x.type === 'FLAGS')) expect(r.answer).toContain(String(w.byId.get(x.from)!.props.rule))
  })

  it('confidence folds in how strongly the question matched: a vector-only match scores below the same answer found lexically', () => {
    const q = starterQuestions(w)[2]
    const hybrid = ask(q).response
    const vector = ask(q, { mode: 'vector' }).response
    expect(vector.confidence).toBeGreaterThan(0)
    expect(vector.confidence).toBeLessThan(hybrid.confidence)
  })

  it('context on: resolves "its" against the previous answer', () => {
    const first = ask(`Who ultimately owns ${S.MERIDIAN_NAME}?`).response
    const history = [
      { role: 'user' as const, text: `Who ultimately owns ${S.MERIDIAN_NAME}?` },
      { role: 'assistant' as const, text: first.answer },
    ]
    const { response: r, stages } = ask('Who else shares its address?', {}, history)
    expect(r.resolvedQuestion).toMatch(/Meridian/)
    expect(stages[0].id).toBe('context')
    expect(r.subgraph.nodes.find((n) => n.id === MERIDIAN)?.seed).toBe(true)
  })

  it('context off: leaves the question alone and says so', () => {
    const history = [
      { role: 'user' as const, text: `Who ultimately owns ${S.MERIDIAN_NAME}?` },
      { role: 'assistant' as const, text: `${S.MERIDIAN_NAME} is ultimately owned by ${S.UBO_NAME}.` },
    ]
    const { response: r, stages } = ask('Who else shares its address?', { useContext: false }, history)
    expect(r.resolvedQuestion).toBeNull()
    expect(stages.find((s) => s.id === 'context')?.detail).toBe('Context disabled.')
  })

  it('extractive: generateAnswer=false ends with the extractive stage', () => {
    const { stages, response: r } = ask(`Who ultimately owns ${S.MERIDIAN_NAME}?`, { generateAnswer: false })
    const last = stages[stages.length - 1]
    expect(last.id).toBe('extractive')
    expect(last.detail).toBe('Returned the grounding facts verbatim without an LLM pass.')
    expect(r.answer.split('\n').every((l) => l.startsWith('- '))).toBe(true)
    expect(citedNumbers(r).length).toBeGreaterThan(0)
  })

  it('lexical mode skips vector and fuse', () => {
    const ids = ask(`Who ultimately owns ${S.MERIDIAN_NAME}?`, { mode: 'lexical' }).stages.map((s) => s.id)
    expect(ids).not.toContain('vector')
    expect(ids).not.toContain('fuse')
    expect(ids).toContain('lexical')
  })

  it('vector mode skips lexical and fuse', () => {
    const ids = ask(`Who ultimately owns ${S.MERIDIAN_NAME}?`, { mode: 'vector' }).stages.map((s) => s.id)
    expect(ids).toEqual(['context', 'vector', 'seeds', 'expand', 'rank', 'passages', 'generate'])
  })

  it('stages run in order and ms is 0', () => {
    const { stages, response: r } = ask(`Who ultimately owns ${S.MERIDIAN_NAME}?`)
    expect(stages.map((s) => s.id)).toEqual(['context', 'lexical', 'vector', 'fuse', 'seeds', 'expand', 'rank', 'passages', 'generate'])
    expect(stages.every((s) => s.ms === 0)).toBe(true)
    expect(r.trace).toEqual(stages)
  })

  it.each<Mode>(['hybrid', 'lexical', 'vector', 'graph'])('cypher per stage (%s)', (mode) => {
    const { stages, response: r } = ask(`Who ultimately owns ${S.MERIDIAN_NAME}?`, { mode })
    const executed = stages.map((s) => s.id).filter((id) => !['context', 'generate', 'extractive'].includes(id))
    expect(r.cypher.map((c) => c.stage)).toEqual(executed)
    const all = r.cypher.map((c) => c.query).join('\n')
    if (mode !== 'vector') expect(all).toContain("db.index.fulltext.queryNodes('entityNames', $q)")
    if (mode !== 'lexical') expect(all).toContain("db.index.vector.queryNodes('entityEmbeddings', 12, $embedding)")
    expect(all).toContain('apoc.path.subgraphAll(seed')
    expect(all).toContain("labelFilter: '-Section|-Document'")
    expect(all).toContain('MATCH (s:Section {id: r.section_id})')
  })

  it('graph mode expands 3 hops, other modes 1', () => {
    const q = `Who ultimately owns ${S.MERIDIAN_NAME}?`
    const expandQuery = (mode: Mode) => ask(q, { mode }).response.cypher.find((c) => c.stage === 'expand')!.query
    expect(expandQuery('graph')).toContain('$hops = 3')
    expect(expandQuery('hybrid')).toContain('$hops = 1')
  })

  it('confidence is the mean of used fact confidences, 2 places', () => {
    const { response: r } = ask(`Who ultimately owns ${S.MERIDIAN_NAME}?`)
    const used = r.facts.filter((f) => f.used)
    const mean = used.reduce((a, f) => a + f.confidence, 0) / used.length
    expect(r.confidence).toBe(Math.round(mean * 100) / 100)
  })

  it('gives 3 follow-ups that name the focal entity', () => {
    const { response: r } = ask(`Who ultimately owns ${S.MERIDIAN_NAME}?`)
    expect(r.followUps).toHaveLength(3)
    for (const f of r.followUps) expect(f).toContain(S.MERIDIAN_NAME)
  })

  it.each([
    `Who ultimately owns ${S.MERIDIAN_NAME}?`,
    `Is ${S.FRONT_COMPANY_NAME} connected to a sanctioned party?`,
    `Who else shares ${S.FRONT_COMPANY_NAME}'s address?`,
    'Why was the 14 March wire flagged?',
    `Show the money trail for account ${name(COLLECTOR)}`,
    `Which regulation requires reporting suspicious activity for ${S.FRONT_COMPANY_NAME}?`,
  ])('numbers citations in reading order: %s', (q) => {
    const { response: r } = ask(q)
    const firsts = [...new Set(citedNumbers(r))]
    expect(firsts.length).toBeGreaterThan(0)
    expect(firsts).toEqual(firsts.map((_, i) => i + 1))
    expect(r.citations.map((c) => c.n)).toEqual(firsts)
  })

  it('regulation: names the UK regime for a UK company and leaves out US rules', () => {
    const { response: r } = ask(`Which regulation requires reporting suspicious activity for ${S.FRONT_COMPANY_NAME}?`)
    expect(r.answer).toContain('Proceeds of Crime Act 2002')
    expect(r.answer).not.toMatch(/FinCEN|Bank Secrecy/)
  })

  it.each([
    ['acc-isolde-dunleavy', 'Isolde Dunleavy'],
    ['acc-mule-1', 'Jordan Pryce'],
  ])('ownership of a person-held account %s names the holder', (id, holder) => {
    const { response: r } = ask(`Who owns account ${name(id)}?`)
    expect(r.answer).toContain(`is held by ${holder}`)
    expect(r.answer).not.toMatch(/^The graph holds no/)
    const holds = r.facts.find((f) => f.relation === 'HOLDS' && f.object === name(id))!
    expect(holds.used).toBe(true)
  })

  it.each([
    `Who owns account ${'Prairie First Bank 1283373148'}?`,
    'Who owns account GB72 TGBK 4023 4484 4603 77?',
    `Who ultimately owns account ${'GB29 TGBK 4030 1078 9245 71'}?`,
    `Who ultimately owns ${S.MERIDIAN_NAME}?`,
    'What does Viktor Halden own?',
    `Is ${S.FRONT_COMPANY_NAME} connected to a sanctioned party?`,
    'Is Volgamar Seafoods GmbH connected to a sanctioned party?',
    'Why was the 14 March wire flagged?',
    'Why was Driftwood Timber LLC flagged?',
    'Who else uses the same device as Jordan Pryce?',
    'Tell me about Driftwood Timber LLC',
  ])('every used fact is cited: %s', (q) => {
    const { response: r } = ask(q)
    const cited = new Set(r.citations.map((c) => c.section_id))
    for (const f of r.facts.filter((x) => x.used && x.section_id)) expect(cited, `${f.subject} ${f.relation} ${f.object}`).toContain(f.section_id)
  })

  it('is deterministic', () => {
    const q = `Is ${name(FRONT_COMPANY)} connected to a sanctioned party?`
    expect(ask(q)).toEqual(ask(q))
  })
})

describe('classify', () => {
  it.each([
    ['Who ultimately owns Meridian Trade LLC?', 'ownership'],
    ['Who are the directors of Kestrel Bay?', 'ownership'],
    ['Who else shares that address?', 'shared'],
    ['Is account GB29 TGBK 4030 1078 9245 71 connected to a sanctioned party?', 'sanctions'],
    ['Show the money trail', 'trail'],
    ['Why was the 14 March wire flagged?', 'flagged'],
    ['Which regulation requires reporting this?', 'regulation'],
    ['Tell me about Yarrow Textiles Ltd', 'profile'],
  ])('%s -> %s', (q, intent) => {
    expect(classify(q)).toBe(intent)
  })
})

describe('resolveContext', () => {
  const history = [
    { role: 'user' as const, text: 'Who ultimately owns Meridian Trade LLC?' },
    { role: 'assistant' as const, text: 'Meridian Trade LLC is ultimately owned by Viktor Halden.' },
  ]

  it('leaves a self-contained question alone', () => {
    expect(resolveContext('Who ultimately owns Meridian Trade LLC?', history)).toEqual({
      resolved: 'Who ultimately owns Meridian Trade LLC?',
      changed: false,
      detail: 'No pronouns or ellipsis to resolve.',
    })
  })

  it('substitutes a pronoun with the most recent named entity', () => {
    const r = resolveContext('Who else shares its address?', history)
    expect(r.changed).toBe(true)
    expect(r.resolved).toBe("Who else shares Meridian Trade LLC's address?")
  })

  it('resolves "that address"', () => {
    expect(resolveContext('Who else shares that address?', history).resolved).toBe("Who else shares Meridian Trade LLC's address?")
  })

  it('does not treat a relative "that" as a pronoun', () => {
    expect(resolveContext('Which accounts that received wires are flagged?', history).changed).toBe(false)
  })

  it('carries the previous question over for "what about"', () => {
    const h = [
      { role: 'user' as const, text: 'Is Kestrel Bay Trading Ltd connected to a sanctioned party?' },
      { role: 'assistant' as const, text: 'Kestrel Bay Trading Ltd is two hops from a listed entry.' },
    ]
    expect(resolveContext('What about Volgamar Seafoods GmbH?', h).resolved).toBe('Is Volgamar Seafoods GmbH connected to a sanctioned party?')
  })

  it('carries the previous question over when "and" names only an entity', () => {
    expect(resolveContext('And Kestrel Bay Trading Ltd?', history).resolved).toBe('Who ultimately owns Kestrel Bay Trading Ltd?')
    expect(resolveContext('What about the Kestrel Bay Trading Ltd?', history).resolved).toBe('Who ultimately owns Kestrel Bay Trading Ltd?')
  })

  it.each(['And is Kestrel Bay Trading Ltd connected to a sanctioned party?', 'And who are the directors of Kestrel Bay Trading Ltd?'])(
    'leaves a self-contained "and" question alone: %s',
    (q) => {
      expect(resolveContext(q, history)).toEqual({ resolved: q, changed: false, detail: 'No pronouns or ellipsis to resolve.' })
    },
  )

  it('applies ellipsis to the most recent entity when no new one is named', () => {
    expect(resolveContext('And the directors?', history).resolved).toBe('And the directors of Meridian Trade LLC?')
  })

  it('applies a question that only names what to do ("Show the money trail") to the conversation subject', () => {
    const r = resolveContext('Show the money trail', history)
    expect(r.changed).toBe(true)
    expect(r.resolved).toBe('Show the money trail for Meridian Trade LLC')
  })

  it('leaves an intent-only question alone at the start of a conversation', () => {
    expect(resolveContext('Show the money trail', []).changed).toBe(false)
  })

  it("prefers the previous user turn's subject over other entities the answer names first", () => {
    const h = [
      { role: 'user' as const, text: 'Who ultimately owns Meridian Trade LLC?' },
      { role: 'assistant' as const, text: 'Viktor Halden ultimately owns Meridian Trade LLC.' },
    ]
    expect(resolveContext('Who else shares its address?', h).resolved).toBe("Who else shares Meridian Trade LLC's address?")
  })

  it('keeps the subject through a chain of follow-ups', () => {
    const h = [
      ...history,
      { role: 'user' as const, text: 'Show the money trail' },
      { role: 'assistant' as const, text: 'The graph holds no transactions for Money Laundering Regulations 2017 (UK MLRs).' },
    ]
    expect(resolveContext('Which regulation requires reporting this?', h).resolved).toBe('Which regulation requires reporting Meridian Trade LLC?')
  })
})

describe('conversation script: the spec follow-ups after each seeded starter question', () => {
  const FOLLOW_UPS = ['Who else shares that address?', 'Show the money trail', 'Which regulation requires reporting this?']
  const starters = starterQuestions(w)
  it.each([
    [starters[0], MERIDIAN],
    [starters[1], FRONT_COMPANY],
    [`Is ${S.FRONT_COMPANY_NAME} connected to a sanctioned party?`, FRONT_COMPANY],
    [starters[2], ALERTED_TXN],
    [starters[3], S.MULE_ACCOUNTS[0]],
  ])('%s', (first, subject) => {
    const history: ChatRequest['history'] = []
    const turn = (q: string) => {
      const { response } = ask(q, {}, history)
      history.push({ role: 'user', text: q }, { role: 'assistant', text: response.answer })
      return response
    }
    turn(first)
    for (const q of FOLLOW_UPS) {
      const r = turn(q)
      expect(r.resolvedQuestion, q).toContain(name(subject))
      expect(r.subgraph.nodes.find((n) => n.id === subject)?.seed, q).toBe(true)
      expect(r.answer, q).not.toContain('No matching')
    }
  })
})

describe('intent pattern Cypher', () => {
  const expandQuery = (q: string) => ask(q).response.cypher.find((c) => c.stage === 'expand')!.query
  /** (Label pairs) for each type, as stored in the dataset. */
  const directions = new Set(w.rels.map((r) => `${w.byId.get(r.from)!.label}-${r.type}->${w.byId.get(r.to)!.label}`))
  const NODE = String.raw`\((\w*)(?::(\w+))?[^)]*\)`

  /** Every hop written with labels on both ends must exist in the data in that direction. */
  function checkDirections(query: string) {
    const labels = new Map<string, string>()
    for (const m of query.matchAll(/\((\w+):(\w+)/g)) labels.set(m[1], m[2])
    const hop = new RegExp(`${NODE}(<?)-\\[\\w*:([A-Z_|]+)[^\\]]*\\]-(>?)(?=${NODE})`, 'g')
    let checked = 0
    for (const m of query.matchAll(hop)) {
      const rest = query.slice(m.index! + m[0].length)
      const next = new RegExp(`^${NODE}`).exec(rest)!
      const [left, right] = [m[2] ?? labels.get(m[1]), next[2] ?? labels.get(next[1])]
      if (!left || !right || (!m[3] && !m[5])) continue
      const [from, to] = m[5] ? [left, right] : [right, left]
      for (const t of m[4].split('|')) {
        const ok = directions.has(`${from}-${t}->${to}`)
        if (ok) checked++
        expect(ok || m[4].includes('|'), `${from}-${t}->${to}`).toBe(true)
      }
    }
    return checked
  }

  it('shared: directors are (:Person)-[:DIRECTOR_OF]->(:Company) on both sides', () => {
    const q = expandQuery(`Who else shares a director with ${S.FRONT_COMPANY_NAME}?`)
    expect(q).toContain('(focal)<-[d1:DIRECTOR_OF]-(p:Person)-[d2:DIRECTOR_OF]->(other:Company)')
    expect(checkDirections(q)).toBeGreaterThan(0)
  })

  it('trail: a Transaction focal is matched from its accounts', () => {
    const q = expandQuery(`Show the money trail for ${name(ALERTED_TXN)}`)
    expect(q).toContain('(acct:Account)-[r1:SENT|RECEIVED]->(focal:Transaction)')
    expect(q).not.toContain('coalesce(held, focal)')
    expect(checkDirections(q)).toBeGreaterThan(0)
  })

  it('flagged: an Alert focal flags its transactions', () => {
    // The high-value alert: the other one's name ("Sanctions proximity") reads as a sanctions question.
    const alert = (w.in.get(ALERTED_TXN) ?? []).find((r) => r.type === 'FLAGS' && w.byId.get(r.from)!.props.rule === 'HIGH_VALUE_WIRE')!.from
    const q = expandQuery(`Why did ${name(alert)} flag?`)
    expect(q).toContain('(focal:Alert)-[f:FLAGS]->(t:Transaction)')
    expect(checkDirections(q)).toBeGreaterThan(0)
  })

  it.each([
    `Who ultimately owns ${S.MERIDIAN_NAME}?`,
    `Who else shares ${S.FRONT_COMPANY_NAME}'s address?`,
    `Is ${S.FRONT_COMPANY_NAME} connected to a sanctioned party?`,
    `Show the money trail for account ${name(COLLECTOR)}`,
    'Why was the 14 March wire flagged?',
    `Which regulation requires reporting suspicious activity for ${S.FRONT_COMPANY_NAME}?`,
  ])('labelled hops follow the dataset directions: %s', (q) => {
    checkDirections(expandQuery(q))
  })
})
