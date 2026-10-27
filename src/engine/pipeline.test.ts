import { describe, expect, it } from 'vitest'
import { loadWorld } from '../data/load'
import * as S from '../data/scenarios'
import { ALERTED_TXN, BENIGN_LOOKALIKES, COLLECTOR, FRONT_COMPANY, FRONT_DIRECTOR, MERIDIAN, UBO } from '../data/scenarios'
import type { ChatRequest, ChatResponse, Mode, Settings } from '../domain/types'
import { resolveContext } from './context'
import { classify } from './intents'
import { runPipeline } from './pipeline'

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

  it('applies ellipsis to the most recent entity when no new one is named', () => {
    expect(resolveContext('And the directors?', history).resolved).toBe('And the directors of Meridian Trade LLC?')
  })
})
