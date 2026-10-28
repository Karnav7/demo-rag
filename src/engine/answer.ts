import type { GNode, GRel } from '../domain/types'
import type { WorldIndex } from '../data/load'
import { INTENTS, pctOf, type Intent, type Match, type Party } from './intents'

export const NO_MATCH = 'No matching facts in the graph.'

/** Numbers sections in order of first citation and records which relationships the answer relied on. */
export class Citations {
  private bySection = new Map<string, number>()
  readonly used = new Set<string>()
  readonly order: GRel[] = []

  /** Cite relationships: returns " [1][2]" (or "" when none has a source section). */
  rel(...rels: (GRel | undefined)[]): string {
    const ns: number[] = []
    for (const r of rels) {
      if (!r) continue
      if (!this.used.has(r.id)) this.order.push(r)
      this.used.add(r.id)
      if (r.section_id) ns.push(this.number(r.section_id))
    }
    return render(ns)
  }

  section(id: string | null): string {
    return id ? render([this.number(id)]) : ''
  }

  list(): { n: number; section_id: string }[] {
    return [...this.bySection].map(([section_id, n]) => ({ n, section_id })).sort((a, b) => a.n - b.n)
  }

  /** Renumber markers in order of first appearance in the text; drop numbers the text never shows. */
  finalize(text: string): string {
    const remap = new Map<number, number>()
    const out = text.replace(/\[(\d+)\]/g, (_, d: string) => {
      const old = Number(d)
      if (!remap.has(old)) remap.set(old, remap.size + 1)
      return `[${remap.get(old)}]`
    })
    const sections = [...this.bySection]
    this.bySection = new Map(sections.filter(([, n]) => remap.has(n)).map(([id, n]) => [id, remap.get(n)!]))
    return out
  }

  private number(sectionId: string): number {
    let n = this.bySection.get(sectionId)
    if (!n) this.bySection.set(sectionId, (n = this.bySection.size + 1))
    return n
  }
}

function render(ns: number[]): string {
  const uniq = [...new Set(ns)]
  return uniq.length ? ' ' + uniq.map((n) => `[${n}]`).join('') : ''
}

// --- formatting -------------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function fmtDate(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(iso ?? '')
}

export function fmtMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtPct(fraction: number): string {
  return `${Math.round(fraction * 10000) / 100}%`
}

const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const count = (n: number, one: string, many = `${one}s`) => `${n < words.length ? words[n] : n} ${n === 1 ? one : many}`

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const b = (s: string) => `**${s}**`

function jurName(w: WorldIndex, code: string | undefined): string {
  if (!code) return ''
  return w.nodes.find((n) => n.label === 'Jurisdiction' && n.jurisdiction === code)?.name ?? code
}

/** "GB29 … (Kestrel Bay Trading Ltd)" */
function partyName(p: Party | undefined): string {
  if (!p) return 'an unrecorded account'
  return p.holder ? `${p.account.name} (${p.holder.name})` : p.account.name
}

const CHANNELS: Record<string, string> = { wire: 'wire', cash: 'cash deposit', 'faster-payment': 'Faster Payment', sepa: 'SEPA transfer', ach: 'ACH transfer' }
const channelName = (t: GNode) => CHANNELS[String(t.props.channel)] ?? String(t.props.channel ?? 'payment')

/** "Wire of GBP 486,500.00 on 14 March 2026" */
function txnPhrase(t: GNode): string {
  const channel = channelName(t)
  const money = typeof t.props.amount === 'number' ? ` of ${fmtMoney(t.props.amount, String(t.props.currency ?? ''))}` : ''
  return `${channel[0].toUpperCase()}${channel.slice(1)}${money} on ${fmtDate(t.props.date)}`
}

function relWords(r: GRel, w: WorldIndex): string {
  const s = w.byId.get(r.from)?.name ?? r.from
  const o = w.byId.get(r.to)?.name ?? r.to
  const extra = r.type === 'OWNS' ? ` (${fmtPct(pctOf(r))})` : r.type === 'MATCHES' ? ` (score ${r.props.score})` : ''
  return `${s} ${r.type} ${o}${extra}`
}

// --- templates --------------------------------------------------------------------------------

type Writer<I extends Intent> = (w: WorldIndex, m: Extract<Match, { intent: I }>, c: Citations) => string | null

const ownership: Writer<'ownership'> = (w, m, c) => {
  const { focal, subject } = m
  // Decide before citing anything, so an empty answer leaves no facts marked used.
  const records = m.owners.length + m.holdings.length + m.control.length + m.directors.length + m.directorships.length
  if (!records && !m.holderRel) return null
  const lines: string[] = []
  const lead = focal.id !== subject.id ? `Account ${focal.name} is held by ${subject.name}${c.rel(m.holderRel)}. ` : ''
  let leadUsed = false
  const withLead = (s: string) => {
    const out = leadUsed ? s : `${lead}${s}`
    leadUsed = true
    return out
  }

  // "Who are the directors of X?": directors and controllers first, ownership after.
  const directorNames = () => m.directors.map((r) => `${w.byId.get(r.from)!.name}${r.props.role ? ` (${r.props.role})` : ''}${c.rel(r)}`)
  const directorshipNames = () => m.directorships.map((r) => `${w.byId.get(r.to)!.name}${r.props.role && r.props.role !== 'director' ? ` (${r.props.role})` : ''}${c.rel(r)}`)
  const controlFirst = m.controlFirst && (m.directors.length || m.directorships.length || m.control.length)
  if (controlFirst) {
    if (m.directors.length) lines.push(withLead(`${b(`${subject.name} has ${count(m.directors.length, 'director')}`)}: ${joinList(directorNames())}.`))
    else if (m.directorships.length) lines.push(withLead(`${b(`${subject.name} is a director of ${count(m.directorships.length, 'company', 'companies')}`)}: ${joinList(directorshipNames())}.`))
    else lines.push(withLead(`${b(`No directors of ${subject.name} are recorded in the graph`)}.`))
  }
  if (controlFirst && m.directors.length && m.directorships.length) lines.push('', `${subject.name} is a director of ${joinList(directorshipNames())}.`)
  const controlLines = () => {
    const control = m.control.map((r) => {
      const notes = [r.props.basis && `basis: ${r.props.basis}`, r.confidence < 0.8 && `extraction confidence ${r.confidence}`].filter(Boolean)
      return `${w.byId.get(r.from)!.name} controls ${w.byId.get(r.to)!.name}${notes.length ? ` (${notes.join('; ')})` : ''}${c.rel(r)}`
    })
    if (control.length) lines.push('', `Control: ${joinList(control)}.`)
  }
  if (controlFirst) {
    controlLines()
    lines.push('')
  }

  if (m.owners.length) {
    const [top, ...rest] = m.owners
    const path = top.paths[0]
    const via = path.slice(1).map((r) => w.byId.get(r.to)!)
    const through = via.length
      ? `through ${count(via.length, 'intermediate company', 'intermediate companies')}: ${joinList(via.reverse().map((n) => `${n.name} (${jurName(w, n.jurisdiction) || 'unknown jurisdiction'})`))}`
      : 'directly'
    const direct = path.length === 1 ? c.rel(...path) : ''
    lines.push(
      top.owner.label === 'Person'
        ? withLead(`${b(`${subject.name} is ultimately owned by ${top.owner.name}`)}, who holds an effective ${b(fmtPct(top.pct))} interest ${through}${direct}.`)
        : withLead(`${b(`${subject.name}'s ownership chain ends at ${top.owner.name}`)}, which holds an effective ${b(fmtPct(top.pct))} ${through}${direct} and has no recorded shareholders of its own.`),
    )
    if (path.length > 1) {
      lines.push('', 'Ownership chain:')
      path.forEach((r, i) => lines.push(`${i + 1}. ${w.byId.get(r.from)!.name} owns ${fmtPct(pctOf(r))} of ${w.byId.get(r.to)!.name}${c.rel(r)}`))
      lines.push('', `Effective interest: ${path.map((r) => fmtPct(pctOf(r))).join(' × ')} = ${b(fmtPct(top.pct))}.`)
    }
    if (rest.length) {
      const others = rest.map((o) => {
        const first = o.paths[0]
        const via = first.length > 1 ? `, through ${w.byId.get(first[first.length - 1].to)!.name}` : ''
        // Only the links not already cited in the chain above get their own markers.
        const fresh = o.paths.flat().filter((r) => !c.used.has(r.id))
        return `${o.owner.name} (effective ${fmtPct(o.pct)}${via})${c.rel(...fresh)}`
      })
      lines.push('', `Other ultimate owners: ${joinList(others)}.`)
    }
  } else if (subject.label !== 'Person') {
    lines.push(withLead(`${b(`No shareholders of ${subject.name} are recorded in the graph`)}.`))
  }

  if (m.holdings.length) {
    const direct = m.holdings.filter((h) => h.path.length === 1)
    const indirect = m.holdings.filter((h) => h.path.length > 1)
    const directly = direct.length === m.holdings.length ? ', all directly' : direct.length ? `, ${words[direct.length] ?? direct.length} of them directly` : ''
    const head = `${b(`${subject.name} holds ownership interests in ${count(m.holdings.length, 'company', 'companies')}`)}${directly}.`
    lines.push(leadUsed ? head : withLead(head), '')
    for (const h of direct) lines.push(`- ${h.company.name}: ${fmtPct(h.pct)} directly${c.rel(...h.path)}`)
    for (const h of indirect) {
      const via = h.path.slice(0, -1).map((r) => w.byId.get(r.to)!.name)
      lines.push(`- ${h.company.name}: effective ${fmtPct(h.pct)} through ${joinList(via)}${c.rel(...h.path)}`)
    }
  }

  if (!controlFirst) {
    controlLines()
    if (m.directors.length) lines.push('', `${m.directors.length === 1 ? 'Director' : 'Directors'} of ${subject.name}: ${joinList(directorNames())}.`)
    if (m.directorships.length) lines.push('', `${subject.name} is a director of ${joinList(directorshipNames())}.`)
  }
  if (lead && !leadUsed) {
    lines.unshift(lead.trim())
    if (!records) lines.push(`No ownership, directorship or control records exist for ${subject.name}.`)
  }
  if (!lines[0]) lines.shift()
  return lines.join('\n').trim()
}

const KIND = { address: 'an address', device: 'a device', director: 'a director' } as const

const shared: Writer<'shared'> = (w, m, c) => {
  const { focal } = m
  const withOthers = m.groups.filter((g) => g.others.length)
  if (!m.groups.length) return null
  if (!withOthers.length) {
    const lines = [`${b(`No other entity in the graph shares an address, device or director with ${focal.name}.`)} Its recorded attributes:`, '']
    for (const g of m.groups) {
      const what = g.kind === 'director' ? `Director ${g.via.name}` : `${g.kind === 'address' ? 'Address' : 'Device'} ${g.via.name}`
      lines.push(`- ${what}${c.rel(...g.link)}`)
    }
    return lines.join('\n')
  }
  const names = new Set(withOthers.flatMap((g) => g.others.map((o) => o.node.id)))
  const kinds = [...new Set(withOthers.map((g) => KIND[g.kind]))]
  const lines = [`${b(`${focal.name} shares ${joinList(kinds)} with ${count(names.size, 'other entity', 'other entities')}.`)}`, '']
  for (const g of withOthers) {
    const others = g.others.map((o) => {
      const listed = o.listed ? `, itself matched to sanctions entry ${w.byId.get(o.listed.to)!.name} (score ${o.listed.props.score})${c.rel(o.listed)}` : ''
      const holder = o.rels.find((r) => r.type === 'HOLDS' && r.to === o.node.id)
      const name = holder ? `${o.node.name} (${w.byId.get(holder.from)!.name})` : o.node.name
      return `${name}${c.rel(...o.rels)}${listed}`
    })
    if (g.kind === 'address') lines.push(`- ${b('Address')} ${g.via.name}${c.rel(...g.link)}: also registered here ${others.length === 1 ? 'is' : 'are'} ${joinList(others)}.`)
    else if (g.kind === 'device') lines.push(`- ${b('Device')} ${g.via.name}${c.rel(...g.link)}: also used by ${joinList(others)}.`)
    else lines.push(`- ${b('Director')} ${g.via.name}${c.rel(...g.link)} also directs ${joinList(others)}.`)
  }
  const alone = m.groups.filter((g) => !g.others.length && g.kind !== 'director')
  if (alone.length) lines.push('', `Not shared: ${joinList(alone.map((g) => `${g.via.name}${c.rel(...g.link)}`))}.`)
  return lines.join('\n')
}

function pathText(nodes: GNode[], path: GRel[]): string {
  let s = nodes[0].name
  path.forEach((r, i) => {
    const next = nodes[i + 1].name
    s += r.from === nodes[i].id ? ` —${r.type}→ ${next}` : ` ←${r.type}— ${next}`
  })
  return s
}

const sanctions: Writer<'sanctions'> = (w, m, c) => {
  const { focal } = m
  const lines: string[] = []
  const cleared = () =>
    m.cleared.map((r) => {
      const why = r.props.method ? `, ${r.props.method}` : ''
      return `- Cleared: ${w.byId.get(r.from)!.name}'s screening hit against ${w.byId.get(r.to)!.name} (score ${r.props.score}${why}) was dispositioned as a false positive${c.rel(r)}.`
    })
  if (!m.hits.length) {
    lines.push(`${b(`No sanctions connection was found for ${focal.name}.`)} None of the ${count(m.checked, 'entity', 'entities')} within ${m.hops} hops (owners, directors, accounts, payments, shared addresses and devices) matches a sanctions-list entry.`)
    if (m.ties.length) lines.push('', `Ties checked include ${joinList(m.ties.map((r) => `${tieWords(w, focal, r)}${c.rel(r)}`))}.`)
    const cl = cleared()
    if (cl.length) lines.push('', ...cl)
    return lines.join('\n')
  }
  const first = m.hits[0]
  const hops = (n: number) => count(n, 'hop')
  lines.push(
    m.hits.length === 1
      ? `${b(`${focal.name} is ${hops(first.path.length)} from a sanctions-list entry`)}: ${first.entry.name}, matched with a score of ${b(String(first.match.props.score))}.`
      : `${b(`${focal.name} is connected to ${count(m.hits.length, 'sanctions-list entry', 'sanctions-list entries')} within ${m.hops} hops`)}. The closest is ${first.entry.name}, ${hops(first.path.length)} away, matched with a score of ${b(String(first.match.props.score))}.`,
    '',
  )
  for (const h of m.hits) {
    const e = h.entry.props
    const ref = [e.program, e.list_ref].filter(Boolean).join(', ')
    const method = h.match.props.method ? `, ${h.match.props.method}` : ''
    lines.push(`- ${b(h.entry.name)}${ref ? ` (${ref})` : ''}, ${hops(h.path.length)}: ${pathText(h.nodes, h.path)}. Match score ${b(String(h.match.props.score))}${method}${c.rel(...h.path)}.`)
  }
  lines.push(...cleared())
  return lines.join('\n')
}

/** "director Jens Albrecht", "account DE18 …", seen from the focal entity. */
function tieWords(w: WorldIndex, focal: GNode, r: GRel): string {
  const outgoing = r.from === focal.id
  const other = w.byId.get(outgoing ? r.to : r.from)!
  switch (r.type) {
    case 'OWNS': return outgoing ? `a ${fmtPct(pctOf(r))} stake in ${other.name}` : `owner ${other.name} (${fmtPct(pctOf(r))})`
    case 'DIRECTOR_OF': return outgoing ? `a directorship of ${other.name}` : `director ${other.name}`
    case 'CONTROLS': return outgoing ? `control of ${other.name}` : `controller ${other.name}`
    case 'HOLDS': return outgoing ? `account ${other.name}` : `account holder ${other.name}`
    case 'REGISTERED_AT': return `address ${other.name}`
    case 'USED_DEVICE': return `device ${other.name}`
    case 'SENT': case 'RECEIVED': return outgoing ? `payment ${txnPhrase(other).toLowerCase()}` : `account ${other.name}`
    default: return `${r.type} ${other.name}`
  }
}

function sumBy(items: { amount: number; currency: string }[]): string {
  const totals = new Map<string, number>()
  for (const i of items) totals.set(i.currency, (totals.get(i.currency) ?? 0) + i.amount)
  return joinList([...totals].map(([cur, amt]) => fmtMoney(amt, cur)))
}

const TRAIL_LIMIT = 12

const trail: Writer<'trail'> = (w, m, c) => {
  const { focal } = m
  if (!m.items.length) return null
  const money = (t: GNode) => ({ amount: Number(t.props.amount ?? 0), currency: String(t.props.currency ?? '') })
  const lines: string[] = []
  if (focal.label === 'Transaction') {
    const i = m.items[0]
    const holderRel = m.holders.get(i.account.id)
    const payer: Party = { account: i.account, rel: i.rel, holderRel, holder: holderRel && w.byId.get(holderRel.from) }
    lines.push(`${b(focal.name)} moved from ${partyName(payer)} to ${partyName(i.counter)}${c.rel(i.rel, holderRel, i.counter?.rel, i.counter?.holderRel)}.`)
    const p = focal.props
    const detail = [p.reference && `reference ${p.reference}`, p.purpose && `stated purpose: ${String(p.purpose).toLowerCase()}`].filter(Boolean)
    if (detail.length) lines.push('', `${txnPhrase(focal)}, ${detail.join(', ')}.`)
    return lines.join('\n')
  }
  const inn = m.items.filter((i) => i.dir === 'in')
  const out = m.items.filter((i) => i.dir === 'out')
  const first = fmtDate(m.items[0].txn.props.date)
  const last = fmtDate(m.items[m.items.length - 1].txn.props.date)
  const subject =
    focal.label === 'Account'
      ? `${focal.name}${m.holders.get(focal.id) ? ` (${w.byId.get(m.holders.get(focal.id)!.from)!.name})` : ''}`
      : `${focal.name}'s ${m.accounts.length === 1 ? 'account' : `${count(m.accounts.length, 'account')}`}`
  const parts = [
    inn.length && `received ${count(inn.length, 'payment')} totalling ${sumBy(inn.map((i) => money(i.txn)))}`,
    out.length && `sent ${count(out.length, 'payment')} totalling ${sumBy(out.map((i) => money(i.txn)))}`,
  ].filter(Boolean)
  const holderCite = c.rel(...m.holders.values())
  lines.push(`${b(`${subject} ${joinList(parts as string[])}`)} between ${first} and ${last}${holderCite}.`, '')
  for (const i of m.items.slice(0, TRAIL_LIMIT)) {
    const t = i.txn
    const dir = i.dir === 'in' ? `received ${fmtMoney(money(t).amount, money(t).currency)} from` : `sent ${fmtMoney(money(t).amount, money(t).currency)} to`
    const via = m.accounts.length > 1 ? ` (via ${i.account.name})` : ''
    const purpose = t.props.purpose ? `, “${t.props.purpose}”` : ''
    lines.push(`- ${fmtDate(t.props.date)}: ${dir} ${partyName(i.counter)}${via} by ${channelName(t)}${purpose}${c.rel(i.rel, i.counter?.rel, i.counter?.holderRel)}`)
  }
  if (m.items.length > TRAIL_LIMIT) lines.push(`- …and ${count(m.items.length - TRAIL_LIMIT, 'more transaction')}.`)
  const curs = new Set(m.items.map((i) => money(i.txn).currency))
  if (inn.length && out.length && curs.size === 1) {
    const tin = inn.reduce((a, i) => a + money(i.txn).amount, 0)
    const tout = out.reduce((a, i) => a + money(i.txn).amount, 0)
    const lastIn = inn[inn.length - 1].txn.props.date
    const firstOut = out[0].txn.props.date
    const ratio = tin > 0 ? tout / tin : 0
    if (ratio >= 0.8 && ratio <= 1.05) {
      const after = String(firstOut) >= String(lastIn) ? ', and nothing left until the last payment had arrived' : ''
      lines.push('', `Outflows equal ${Math.round(ratio * 100)}% of inflows: almost everything received was passed on${after}.`)
    }
  }
  return lines.join('\n')
}

function threshold(t: unknown, currency: string): string {
  const n = Number(t)
  if (!Number.isFinite(n)) return String(t)
  const s = n.toLocaleString('en-GB')
  return n >= 1000 && currency ? `${currency} ${s}` : s
}

const flagged: Writer<'flagged'> = (_w, m, c) => {
  const { focal } = m
  if (!m.items.length) return null
  const lines: string[] = []
  const alertLine = (a: GNode, rel: GRel, currency: string) => {
    const p = a.props
    const meta = [p.status, p.score !== undefined && `risk score ${p.score}`].filter(Boolean).join(', ')
    return `- ${b(String(p.rule))} (${a.name.split(' ')[0]}${meta ? `, ${meta}` : ''}): ${p.reason} Threshold: ${threshold(p.threshold, currency)}${c.rel(rel)}.`
  }
  const total = m.items.reduce((a, i) => a + i.alerts.length, 0)
  if (m.items.length === 1) {
    const i = m.items[0]
    const t = i.target
    const what = t.label === 'Transaction' ? `${txnPhrase(t)}${t.props.txn_ref ? ` (${t.props.txn_ref})` : ''}` : t.name
    const rules = [...new Set(i.alerts.map((a) => String(a.alert.props.rule)))]
    lines.push(`${b(`${what} was flagged by ${count(i.alerts.length, 'monitoring alert')}`)}: ${joinList(rules)}.`)
    if (i.payer || i.payee) lines.push(`It was sent from ${partyName(i.payer)} to ${partyName(i.payee)}${c.rel(i.payer?.rel, i.payer?.holderRel, i.payee?.rel, i.payee?.holderRel)}.`)
    lines.push('')
    for (const a of i.alerts) lines.push(alertLine(a.alert, a.rel, String(t.props.currency ?? '')))
    return lines.join('\n')
  }
  lines.push(`${b(`${count(m.items.length, 'transaction')} linked to ${focal.name} ${m.items.length === 1 ? 'was' : 'were'} flagged by ${count(total, 'alert')}`)}.`, '')
  for (const i of m.items) {
    const t = i.target
    const route = i.payer || i.payee ? `, ${partyName(i.payer)} → ${partyName(i.payee)}${c.rel(i.payer?.rel, i.payer?.holderRel, i.payee?.rel, i.payee?.holderRel)}` : ''
    lines.push(`${b(t.label === 'Transaction' ? txnPhrase(t) : t.name)}${route}`)
    for (const a of i.alerts) lines.push(alertLine(a.alert, a.rel, String(t.props.currency ?? '')))
    lines.push('')
  }
  return lines.join('\n').trim()
}

/** The first one or two sentences of a passage, without the closing full stop (the caller adds citations first). */
function gist(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]
  return sentences.slice(0, 2).join('').trim().replace(/\.$/, '')
}

/** "the United Kingdom", "the British Virgin Islands". */
const the = (name: string) => (/^(United|European|British)\b/.test(name) ? `the ${name}` : name)

const regulation: Writer<'regulation'> = (w, m, c) => {
  const { focal } = m
  const items = m.items.filter((i) => i.regs.length)
  if (!items.length) return null
  const lines: string[] = []
  const regNames = (i: (typeof items)[number]) => joinList(i.regs.map((r) => r.reg.name))
  if (items.length === 1 && items[0].via) {
    const i = items[0]
    lines.push(`${b(`${focal.name} is incorporated in ${the(i.jur.name)}`)}${c.rel(i.via)}, so ${regNames(i)} ${i.regs.length === 1 ? 'applies' : 'apply'}.`)
  } else if (items.length === 1) {
    const i = items[0]
    const own = focal.label !== 'Jurisdiction' && focal.label !== 'Regulation' && focal.jurisdiction === i.jur.jurisdiction
    lines.push(
      own
        ? `${b(`${focal.name} is booked in ${the(i.jur.name)}`)}, so ${regNames(i)} ${i.regs.length === 1 ? 'applies' : 'apply'}.`
        : `${b(`In ${the(i.jur.name)}, ${regNames(i)} ${i.regs.length === 1 ? 'applies' : 'apply'}.`)}`,
    )
  } else {
    lines.push(`${b(`Regulations for ${joinList(items.map((i) => the(i.jur.name)))}`)}:`)
  }
  for (const i of items) {
    lines.push('')
    if (items.length > 1) lines.push(`${the(i.jur.name)[0].toUpperCase()}${the(i.jur.name).slice(1)}:`)
    for (const r of i.regs) {
      const section = r.section ? w.sectionById.get(r.section) : undefined
      const cite = (c.rel(r.rel) + (r.section && r.section !== r.rel.section_id ? c.section(r.section) : '')).replace(/\] \[/g, '][')
      const ref = r.reg.props.citation ? ` (${r.reg.props.citation})` : ''
      lines.push(`- ${b(r.reg.name)}${ref}${section ? `, ${section.title.toLowerCase()}: ${gist(section.text)}` : ''}${cite}.`)
    }
  }
  return lines.join('\n')
}

/** Phrases for a relationship seen from the focal entity, grouped under a heading. */
function profileLine(w: WorldIndex, focal: GNode, r: GRel): [string, string] {
  const outgoing = r.from === focal.id
  const other = w.byId.get(outgoing ? r.to : r.from)!
  const p = r.props
  const role = p.role && !(r.type === 'DIRECTOR_OF' && p.role === 'director') ? ` (${p.role})` : ''
  switch (r.type) {
    case 'INCORPORATED_IN': return ['Registration', `incorporated in ${other.name}`]
    case 'REGISTERED_AT': return ['Addresses', `${other.name}${p.kind ? ` (${p.kind})` : ''}`]
    case 'OWNS': return outgoing ? ['Holdings', `owns ${fmtPct(pctOf(r))} of ${other.name}`] : ['Owners', `${other.name} (${fmtPct(pctOf(r))})`]
    case 'DIRECTOR_OF': return outgoing ? ['Directorships', `${other.name}${role}`] : ['Directors', `${other.name}${role}`]
    case 'CONTROLS': return outgoing ? ['Control', `controls ${other.name}${p.basis ? ` (${p.basis})` : ''}`] : ['Control', `controlled by ${other.name}${p.basis ? ` (${p.basis})` : ''}`]
    case 'HOLDS': return outgoing ? ['Accounts', other.name] : ['Holder', other.name]
    case 'SENT': return outgoing ? ['Payments sent', txnPhrase(other)] : ['Parties', `sent by ${other.name}`]
    case 'RECEIVED': return outgoing ? ['Payments received', txnPhrase(other)] : ['Parties', `received by ${other.name}`]
    case 'USED_DEVICE': return outgoing ? ['Devices', other.name] : ['Used by', other.name]
    case 'MATCHES': return ['Screening', `${outgoing ? other.name : `matched by ${other.name}`} (score ${p.score}${p.disposition ? `, ${p.disposition}` : ''})`]
    case 'SUBJECT_OF': return outgoing ? ['Cases', `${other.name}${role}`] : ['Subjects', `${other.name}${role}`]
    case 'FLAGS': return outgoing ? ['Flags', other.name] : ['Alerts', `${other.name} (${other.props.rule})`]
    case 'GOVERNED_BY': return outgoing ? ['Regulations', other.name] : ['Jurisdiction', other.name]
    default: return ['Other', `${r.type} ${other.name}`]
  }
}

function describe(w: WorldIndex, n: GNode): string {
  const p = n.props
  const jur = jurName(w, n.jurisdiction)
  switch (n.label) {
    case 'Company': {
      const reg = [p.registry, p.registry_no && `no. ${p.registry_no}`].filter(Boolean).join(' ')
      return `${b(n.name)} is ${p.status ? `an ${p.status} ` : 'a '}${jur ? `${jur} ` : ''}company${p.industry ? ` in ${String(p.industry).toLowerCase()}` : ''}${p.incorporated ? `, incorporated on ${fmtDate(p.incorporated)}` : ''}${reg ? ` (${reg})` : ''}.`
    }
    case 'Person': {
      const bits = [p.occupation, p.nationality && `${p.nationality} national`, p.dob && `born ${fmtDate(p.dob)}`].filter(Boolean)
      return `${b(n.name)}${bits.length ? ` is a person on file: ${bits.join(', ')}` : ' is a person on file'}.`
    }
    case 'Account': return `${b(n.name)} is ${p.type ? `a ${p.type}` : 'an'} account${p.bank ? ` at ${p.bank}` : ''}${p.currency ? ` in ${p.currency}` : ''}${p.opened ? `, opened ${fmtDate(p.opened)}` : ''}${p.status ? `, status ${p.status}` : ''}.`
    case 'Transaction': return `${b(n.name)}: ${txnPhrase(n).toLowerCase()}${p.reference ? `, reference ${p.reference}` : ''}${p.purpose ? `, stated purpose “${p.purpose}”` : ''}.`
    case 'Case': return `${b(n.name)} is ${p.status ? `an ${p.status}` : 'a'} case${p.priority ? ` (${p.priority} priority)` : ''}${p.opened ? ` opened ${fmtDate(p.opened)}` : ''}${p.analyst ? `, analyst ${p.analyst}` : ''}${p.typology ? `, typology: ${String(p.typology).toLowerCase()}` : ''}.`
    case 'Alert': return `${b(n.name)} is a ${p.rule} alert${p.date ? ` raised ${fmtDate(p.date)}` : ''}${p.status ? `, status ${p.status}` : ''}: ${p.reason}`
    case 'SanctionsEntry': return `${b(n.name)} is listed on the ${p.list}${p.program ? ` under ${p.program}` : ''}${p.list_ref ? ` (${p.list_ref})` : ''}${p.listed_on ? ` since ${fmtDate(p.listed_on)}` : ''}.`
    case 'Device': return `${b(n.name)} is a ${p.type ?? ''} device${p.first_seen ? ` first seen ${fmtDate(p.first_seen)}` : ''}.`
    case 'Regulation': return `${b(n.name)}${p.citation ? ` (${p.citation})` : ''} applies in ${jur || 'its jurisdiction'}.`
    case 'Jurisdiction': return `${b(n.name)}${p.fiu ? `: financial intelligence unit ${p.fiu}` : ''}${p.registry ? `, company registry ${p.registry}` : ''}.`
    default: return `${b(n.name)} (${n.label}).`
  }
}

const PROFILE_ORDER = ['Registration', 'Owners', 'Holder', 'Directors', 'Control', 'Holdings', 'Directorships', 'Addresses', 'Accounts', 'Devices', 'Used by', 'Parties', 'Payments received', 'Payments sent', 'Screening', 'Alerts', 'Flags', 'Cases', 'Subjects', 'Regulations', 'Jurisdiction', 'Other']
const PROFILE_PER_GROUP = 5

const profile: Writer<'profile'> = (w, m, c) => {
  if (!m.rels.length) return null
  const groups = new Map<string, { text: string; rel: GRel }[]>()
  // Dated neighbours (payments) in date order, the rest by relationship id.
  const date = (r: GRel) => String(w.byId.get(r.from === m.focal.id ? r.to : r.from)?.props.date ?? '')
  const rels = [...m.rels].sort((a, b) => date(a).localeCompare(date(b)) || (a.id < b.id ? -1 : 1))
  for (const r of rels) {
    const [h, text] = profileLine(w, m.focal, r)
    groups.set(h, [...(groups.get(h) ?? []), { text, rel: r }])
  }
  const lines = [describe(w, m.focal), '']
  const reg = groups.get('Registration')
  if (reg) {
    lines[0] = lines[0].replace(/\.$/, '') + c.rel(...reg.map((x) => x.rel)) + '.'
    groups.delete('Registration')
  }
  for (const h of PROFILE_ORDER) {
    const items = groups.get(h)
    if (!items) continue
    const shown = items.slice(0, PROFILE_PER_GROUP).map((x) => `${x.text}${c.rel(x.rel)}`)
    const more = items.length > PROFILE_PER_GROUP ? `, and ${items.length - PROFILE_PER_GROUP} more` : ''
    lines.push(`- ${b(h)}: ${shown.join('; ')}${more}`)
  }
  return lines.join('\n').trim()
}

const WRITERS: { [I in Intent]: Writer<I> } = { ownership, shared, sanctions, trail, flagged, regulation, profile }

/** Templated, cited answer for the intent, or null when its pattern found nothing to say. */
export function composeAnswer(w: WorldIndex, m: Match, c: Citations): string | null {
  return (WRITERS[m.intent] as Writer<Intent>)(w, m as never, c)
}

/** Facts verbatim, one bullet each, with citations. */
export function extractive(w: WorldIndex, rels: GRel[], c: Citations): string {
  return rels.map((r) => `- ${relWords(r, w)}${c.rel(r)}`).join('\n')
}

/** Lead line for the fallback when the intent's pattern is empty but the entity has other facts. */
export function fallbackLead(intent: Intent, focal: GNode): string {
  return `The graph holds no ${INTENTS[intent].about} for ${focal.name}. The most relevant facts it does hold:`
}

export const STARTER_QUESTIONS = [
  'Who ultimately owns Meridian Trade LLC?',
  'Is Kestrel Bay Trading Ltd connected to a sanctioned party?',
  'Why was the 14 March wire flagged?',
]

export function followUps(intent: Intent, focal: GNode | null): string[] {
  if (!focal) return STARTER_QUESTIONS
  const n = focal.name
  const q = {
    owns: `Who ultimately owns ${n}?`,
    shares: `Who else shares an address or device with ${n}?`,
    sanctions: `Is ${n} connected to a sanctioned party?`,
    trail: `Show the money trail for ${n}`,
    flagged: `Why was ${n} flagged?`,
    regulation: `Which regulation applies to ${n}?`,
    about: `Tell me about ${n}`,
  }
  const by: Record<Intent, string[]> = {
    ownership: [q.sanctions, q.shares, q.trail],
    shared: [q.owns, q.sanctions, q.about],
    sanctions: [q.owns, q.trail, q.regulation],
    trail: [q.flagged, q.sanctions, q.shares],
    flagged: [q.trail, q.sanctions, q.regulation],
    regulation: [q.about, q.sanctions, q.owns],
    profile: [q.owns, q.sanctions, q.shares],
  }
  return by[intent]
}
