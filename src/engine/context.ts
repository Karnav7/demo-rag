import type { ChatRequest, GNode } from '../domain/types'
import { loadWorld, type WorldIndex } from '../data/load'
import { lexicalSearch } from './lexical'

export interface Resolution { resolved: string; changed: boolean; detail: string }
interface Mention { node: GNode; start: number; end: number; text: string }

const UNCHANGED = 'No pronouns or ellipsis to resolve.'
const POSSESSIVE = new Set(['its', 'their', 'his', 'her'])
const PRONOUN = /\b(it|its|they|their|them|he|she|his|her)\b/gi
/** Nouns after "that"/"this" that make it a demonstrative ("that address"), and the label they refer to. */
const NOUNS: Record<string, GNode['label'] | null> = {
  address: 'Address', device: 'Device', account: 'Account', company: 'Company', firm: 'Company', business: 'Company',
  wire: 'Transaction', transaction: 'Transaction', payment: 'Transaction', transfer: 'Transaction',
  person: 'Person', individual: 'Person', case: 'Case', alert: 'Alert', director: null, entity: null, party: null,
}
/** "that"/"this" as a pronoun: before one of NOUNS, or closing the sentence ("reporting this?"). */
const DEMONSTRATIVE = new RegExp(`\\b(that|this)\\b(?:\\s+(${Object.keys(NOUNS).join('|')})\\b|(?=\\s*[?.!]?\\s*$))`, 'gi')
const ELLIPSIS = /^\s*(?:and|what about|how about)\b[\s,]*(.*)$/i

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Entities named literally in the text (name or alias), earliest first, longest first at the same spot. */
function mentions(w: WorldIndex, text: string): Mention[] {
  const found: Mention[] = []
  for (const hit of lexicalSearch(w, text, 25)) {
    const n = w.byId.get(hit.id)!
    for (const label of [n.name, ...(n.aliases ?? [])]) {
      const m = new RegExp(`(?<![\\w])${escape(label)}(?![\\w])`, 'i').exec(text)
      if (m) found.push({ node: n, start: m.index, end: m.index + m[0].length, text: m[0] })
    }
  }
  return found.sort((a, b) => a.start - b.start || b.end - a.end)
}

/** The entity the conversation is about: the first named in the latest turn that names one (answers lead with their subject). */
function recentEntity(w: WorldIndex, history: ChatRequest['history']): GNode | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = mentions(w, history[i].text)[0]
    if (m) return m.node
  }
  return null
}

/** Replaces pronouns and demonstratives in the text with the entity's name. */
function substitute(text: string, entity: GNode): { text: string; used: string[] } {
  const used: string[] = []
  const out = text
    .replace(PRONOUN, (p) => {
      used.push(p)
      return POSSESSIVE.has(p.toLowerCase()) ? `${entity.name}'s` : entity.name
    })
    .replace(DEMONSTRATIVE, (all, _det: string, noun?: string) => {
      used.push(all)
      if (!noun) return entity.name
      // "that wire" about a transaction is the transaction itself; "that address" about a company is its address.
      return NOUNS[noun.toLowerCase()] === entity.label ? entity.name : `${entity.name}'s ${noun}`
    })
  return { text: out, used }
}

/** Rewrites a follow-up so it stands alone: pronouns and ellipsis resolve to the most recent named entity. */
export function resolveContext(question: string, history: ChatRequest['history'], w: WorldIndex = loadWorld()): Resolution {
  const q = question.trim()
  const own = mentions(w, q)
  const ellipsis = ELLIPSIS.exec(q)
  const hasPronoun = !own.length && (new RegExp(PRONOUN.source, 'i').test(q) || new RegExp(DEMONSTRATIVE.source, 'i').test(q))
  if (!hasPronoun && !ellipsis) return { resolved: q, changed: false, detail: UNCHANGED }

  // "What about Volgamar Seafoods?": ask the previous question again about the newly named entity.
  // Only when the fragment is just the entity; "And who are the directors of X?" already stands alone.
  if (ellipsis && own.length) {
    const leftover = ellipsis[1].replace(new RegExp(escape(own[0].text), 'i'), ' ').replace(/\bthe\b|[?.!,;:\s]/gi, '')
    if (leftover) return { resolved: q, changed: false, detail: UNCHANGED }
    const prevQ = [...history].reverse().find((h) => h.role === 'user')?.text.trim()
    if (!prevQ) return { resolved: q, changed: false, detail: UNCHANGED }
    const old = mentions(w, prevQ)[0]
    if (old) {
      if (old.node.id === own[0].node.id) return { resolved: q, changed: false, detail: UNCHANGED }
      const resolved = prevQ.slice(0, old.start) + own[0].text + prevQ.slice(old.end)
      return { resolved, changed: true, detail: `Carried the previous question over from ${old.node.name} to ${own[0].node.name}.` }
    }
    // The previous question was itself a follow-up ("Which regulation requires reporting this?"): point its reference at the new entity.
    const carried = substitute(prevQ, own[0].node)
    if (carried.used.length) return { resolved: carried.text, changed: true, detail: `Carried the previous question over to ${own[0].node.name}.` }
    return { resolved: q, changed: false, detail: UNCHANGED }
  }

  const entity = recentEntity(w, history)
  if (!entity) return { resolved: q, changed: false, detail: 'Found a reference to an earlier turn but no named entity to resolve it against.' }

  if (hasPronoun) {
    const { text, used } = substitute(q, entity)
    return { resolved: text, changed: true, detail: `Resolved ${used.map((u) => `"${u}"`).join(', ')} to ${entity.name} from the earlier turn.` }
  }

  // "And the directors?": apply the fragment to the most recent entity.
  const rest = q.replace(/[?.!\s]+$/, '')
  return { resolved: `${rest} of ${entity.name}?`, changed: true, detail: `Applied the follow-up to ${entity.name} from the earlier turn.` }
}
