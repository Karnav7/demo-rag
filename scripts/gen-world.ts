// Deterministic generator for src/data/world.json.
// Run with: npm run gen:world   (Node >= 23 strips the TypeScript types natively)
//
// Everything here is fictional: people, companies, banks, account numbers, cases and list entries.
// Regulation sections are short paraphrases written for the demo, not legal text.
//
// Relationship directions (also asserted in src/data/world.test.ts):
//   (Person|Company)-[:OWNS {pct}]->(Company)      (Person)-[:DIRECTOR_OF]->(Company)
//   (Person|Company)-[:CONTROLS]->(Company)        (Person|Company)-[:HOLDS]->(Account)
//   (Account)-[:SENT]->(Transaction)               (Account)-[:RECEIVED]->(Transaction)
//   (Person|Company)-[:REGISTERED_AT]->(Address)   (Account|Person)-[:USED_DEVICE]->(Device)
//   (Person|Company)-[:MATCHES {score}]->(SanctionsEntry)
//   (Company)-[:INCORPORATED_IN]->(Jurisdiction)   (Jurisdiction)-[:GOVERNED_BY]->(Regulation)
//   (Person|Company|Account)-[:SUBJECT_OF]->(Case) (Alert)-[:FLAGS]->(Transaction)
//   (Document)-[:HAS_SECTION]->(Section)

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DocumentMeta, GNode, GRel, NodeLabel, RelType, Section, World } from '../src/domain/types.ts'
import * as S from '../src/data/scenarios.ts'

// ---------------------------------------------------------------- utilities
let seed = 20261027
function rand(): number {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]
const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join('')
const conf = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100) / 100
function shuffle<T>(a: T[]): T[] {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
function randDate(from: string, to: string): string {
  const a = Date.parse(from)
  const b = Date.parse(to)
  return new Date(a + Math.floor(rand() * (b - a))).toISOString().slice(0, 10)
}
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10)
const money = (amount: number, cur: string) =>
  `${cur} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ISO 13616 check digits, so account ids look and validate like real IBANs.
function iban(country: string, bban: string): string {
  const s = (bban + country + '00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let r = 0
  for (const ch of s) r = (r * 10 + Number(ch)) % 97
  return country + String(98 - r).padStart(2, '0') + bban
}
const spaced = (i: string) => i.replace(/(.{4})/g, '$1 ').trim()

// ---------------------------------------------------------------- graph builders
const nodes: GNode[] = []
const rels: GRel[] = []
const documents: DocumentMeta[] = []
const sections: Section[] = []
const byId = new Map<string, GNode>()

function add(id: string, label: NodeLabel, name: string, props: GNode['props'] = {}, extra: Partial<GNode> = {}): GNode {
  if (byId.has(id)) throw new Error(`duplicate id ${id}`)
  const n: GNode = { id, label, name, ...extra, props }
  nodes.push(n)
  byId.set(id, n)
  return n
}
function rel(type: RelType, from: string, to: string, section_id: string, confidence: number, props: GRel['props'] = {}) {
  rels.push({ id: `r-${String(rels.length + 1).padStart(4, '0')}`, type, from, to, confidence, section_id, props })
}
function doc(id: string, kind: DocumentMeta['kind'], title: string, date: string) {
  documents.push({ id, kind, title, date })
  add(id, 'Document', title, { kind, date })
  let n = 0
  return (title: string, text: string): string => {
    const sid = `${id}-s${++n}`
    sections.push({ id: sid, document_id: id, title, text })
    add(sid, 'Section', title, { document_id: id })
    rels.push({ id: `r-${String(rels.length + 1).padStart(4, '0')}`, type: 'HAS_SECTION', from: id, to: sid, confidence: 1, section_id: null, props: {} })
    return sid
  }
}
const nameOf = (id: string) => byId.get(id)!.name

// ---------------------------------------------------------------- jurisdictions and regulations
type Jur = 'US' | 'UK' | 'EU' | 'VG'
const JUR_ID: Record<Jur, string> = { US: 'jur-us', UK: 'jur-uk', EU: 'jur-eu', VG: 'jur-vg' }
add('jur-us', 'Jurisdiction', 'United States', { offshore: false, registry: 'State secretaries of state', fiu: 'FinCEN' }, { jurisdiction: 'US', aliases: ['US', 'USA', 'America', 'American'] })
add('jur-uk', 'Jurisdiction', 'United Kingdom', { offshore: false, registry: 'Companies House', fiu: 'UK Financial Intelligence Unit (NCA)' }, { jurisdiction: 'UK', aliases: ['UK', 'Britain', 'England', 'British'] })
add('jur-eu', 'Jurisdiction', 'European Union', { offshore: false, registry: 'National trade registers', fiu: 'National FIUs' }, { jurisdiction: 'EU', aliases: ['EU', 'Europe', 'Germany', 'Netherlands', 'France', 'Italy', 'Cyprus'] })
add('jur-vg', 'Jurisdiction', 'British Virgin Islands', { offshore: true, registry: 'Registry of Corporate Affairs', fiu: 'Financial Investigation Agency' }, { jurisdiction: 'VG', aliases: ['BVI', 'VG', 'Tortola', 'offshore'] })

interface RegSpec { id: string; jur: Jur; name: string; aliases: string[]; citation: string; date: string; sections: [string, string][] }
const REGS: RegSpec[] = [
  {
    id: 'reg-us-cdd', jur: 'US', name: 'FinCEN Customer Due Diligence Rule', citation: '31 CFR 1010.230', date: '2026-01-15',
    aliases: ['CDD Rule', 'CDD', '31 CFR 1010.230', 'beneficial ownership rule'],
    sections: [
      ['Scope', 'Covered US financial institutions must identify and verify the beneficial owners of legal-entity customers when a new account is opened. The duty applies to banks, broker-dealers, mutual funds and futures intermediaries. This digest is a paraphrase prepared for training and is not the legal text.'],
      ['Beneficial ownership prongs', 'A beneficial owner is each individual who directly or indirectly owns 25 percent or more of the equity interests of the customer. Separately, one individual with significant responsibility to control or manage the entity, such as a chief executive or managing member, must be identified. Interests held through intermediate entities count towards the 25 percent threshold.'],
      ['Ongoing monitoring', 'Institutions must keep customer information current on a risk basis and monitor accounts to identify and report suspicious activity. When monitoring reveals a change in ownership, the beneficial ownership record should be refreshed.'],
    ],
  },
  {
    id: 'reg-us-bsa', jur: 'US', name: 'Bank Secrecy Act reporting and anti-structuring rules', citation: '31 CFR 1010.311; 31 USC 5324', date: '2026-01-15',
    aliases: ['BSA', 'Bank Secrecy Act', 'CTR rule', 'currency transaction report', 'structuring', '31 USC 5324'],
    sections: [
      ['Currency transaction reports', 'Financial institutions must file a currency transaction report for cash deposits, withdrawals or exchanges of more than USD 10,000 in one business day. Several cash transactions by or for the same person are added together when the institution knows of them.'],
      ['Structuring', 'Splitting cash into smaller amounts to stay under the reporting threshold is a federal offence even when the underlying money is lawful. Repeated deposits just below USD 10,000 are a classic indicator and should be considered for a suspicious activity report.'],
      ['Suspicious activity reports', 'Banks must report transactions of USD 5,000 or more that they know or suspect involve illicit funds, are designed to evade reporting, or have no apparent lawful purpose. The report is generally due within 30 days of first detection.'],
    ],
  },
  {
    id: 'reg-eu-amld', jur: 'EU', name: 'EU Anti-Money Laundering Directive (AMLD)', citation: 'Directive (EU) 2015/849, as amended', date: '2026-02-03',
    aliases: ['AMLD', '6AMLD', '5AMLD', 'Directive 2015/849', 'EU AML directive'],
    sections: [
      ['Beneficial ownership', 'Member states require corporate entities to hold adequate, accurate and current information on their beneficial owners. A shareholding of more than 25 percent held by a natural person indicates ownership, and the information must be filed in a central register.'],
      ['Enhanced due diligence', 'Obliged entities apply enhanced due diligence to relationships involving high-risk third countries and to complex or unusually large transactions with no apparent economic purpose. Measures include establishing the source of funds and obtaining senior management approval.'],
      ['Reporting to the FIU', 'Obliged entities must promptly report suspicions to the national financial intelligence unit and hold a suspect transaction until they have done so. The customer must not be told that a report has been made.'],
    ],
  },
  {
    id: 'reg-uk-mlr', jur: 'UK', name: 'Money Laundering Regulations 2017 (UK MLRs)', citation: 'SI 2017/692', date: '2026-02-10',
    aliases: ['MLRs', 'MLR 2017', 'UK MLRs', 'money laundering regulations'],
    sections: [
      ['Customer due diligence', 'Relevant persons must identify customers and verify their identity before establishing a business relationship. For a body corporate this includes identifying any individual who owns or controls more than 25 percent of the shares or voting rights.'],
      ['Enhanced due diligence', 'Enhanced measures apply where the risk of money laundering is high, including relationships with persons established in high-risk third countries and transactions that are complex or unusually large. Firms must examine the background and purpose of such transactions and record their findings.'],
      ['Discrepancy reporting', 'Where a firm finds a material difference between the ownership information it holds and the register of people with significant control, it must report the discrepancy to Companies House. The report should be made without delay once the difference is confirmed.'],
    ],
  },
  {
    id: 'reg-uk-poca', jur: 'UK', name: 'Proceeds of Crime Act 2002 suspicious activity reporting', citation: 'POCA 2002 Part 7', date: '2026-02-10',
    aliases: ['POCA', 'SAR regime', 'UK SAR', 'DAML', 'defence against money laundering'],
    sections: [
      ['Duty to report', 'Staff in the regulated sector who know or suspect money laundering, or have reasonable grounds to do so, must tell their nominated officer. The nominated officer decides whether to submit a suspicious activity report to the National Crime Agency.'],
      ['Defence against money laundering', 'A firm may ask for consent, known as a defence against money laundering, before carrying out a transaction it suspects involves criminal property. Telling the customer that a report has been made can amount to the offence of tipping off.'],
    ],
  },
  {
    id: 'reg-vg-aml', jur: 'VG', name: 'BVI Anti-Money Laundering and Terrorist Financing Code of Practice', citation: 'AMLTFCOP 2008, as revised', date: '2026-03-01',
    aliases: ['BVI AML Code', 'AMLTFCOP', 'BVI code of practice'],
    sections: [
      ['Registered agents', 'Registered agents in the territory must hold verified beneficial ownership information for every company they administer and produce it to the competent authority on request. A holding of 10 percent or more is treated as a beneficial interest for this purpose.'],
      ['Reliance on introducers', 'Agents may rely on introducers for customer due diligence only where written terms guarantee that identification records will be supplied without delay. Responsibility for the adequacy of the due diligence stays with the agent.'],
    ],
  },
]
for (const r of REGS) {
  const docId = `doc-${r.id}`
  const sec = doc(docId, 'regulation', `Regulatory digest: ${r.name} (paraphrased)`, r.date)
  const sids = r.sections.map(([t, x]) => sec(t, x))
  add(r.id, 'Regulation', r.name, { citation: r.citation, document_id: docId }, { jurisdiction: r.jur, aliases: r.aliases })
  rel('GOVERNED_BY', JUR_ID[r.jur], r.id, sids[0], 1)
}

// ---------------------------------------------------------------- banks and accounts
interface Bank { name: string; jur: Jur; country: string; currency: string; bban: () => string }
const BANKS: Record<string, Bank> = {
  thamesgate: { name: 'Thamesgate Bank', jur: 'UK', country: 'GB', currency: 'GBP', bban: () => 'TGBK' + '40' + digits(4) + digits(8) },
  kingsmere: { name: 'Kingsmere Bank', jur: 'UK', country: 'GB', currency: 'GBP', bban: () => 'KMRB' + '20' + digits(4) + digits(8) },
  harbor: { name: 'Harbor Federal Bank', jur: 'US', country: 'US', currency: 'USD', bban: () => digits(10) },
  prairie: { name: 'Prairie First Bank', jur: 'US', country: 'US', currency: 'USD', bban: () => digits(10) },
  rheinhafen: { name: 'Rheinhafen Bank', jur: 'EU', country: 'DE', currency: 'EUR', bban: () => '37040912' + digits(10) },
  lindeveld: { name: 'Lindeveld Bank', jur: 'EU', country: 'NL', currency: 'EUR', bban: () => 'LNDV' + digits(10) },
  stclair: { name: 'Banque Saint-Clair', jur: 'EU', country: 'FR', currency: 'EUR', bban: () => '30788' + digits(5) + digits(11) + digits(2) },
  lagunare: { name: 'Banca Lagunare', jur: 'EU', country: 'IT', currency: 'EUR', bban: () => 'K' + '05584' + digits(5) + digits(12) },
  limassol: { name: 'Limassol Maritime Bank', jur: 'EU', country: 'CY', currency: 'EUR', bban: () => '01700412' + digits(16) },
  tortola: { name: 'Tortola Fiduciary Bank', jur: 'VG', country: 'VG', currency: 'USD', bban: () => 'TFBK' + digits(16) },
}
const ROUTING: Record<string, string> = { harbor: '026104983', prairie: '101205681' }

interface Acct { id: string; bank: string; holder: string; currency: string; txns: { txn: string; dir: 'in' | 'out' }[] }
const accounts = new Map<string, Acct>()
function account(id: string, bankKey: string, holder: string, opened: string, type: string, forceCheck?: string): Acct {
  const b = BANKS[bankKey]
  let display: string
  let aliases: string[]
  const props: GNode['props'] = { bank: b.name, currency: b.currency, type, opened, status: 'open' }
  if (b.country === 'US') {
    const num = b.bban()
    display = `${b.name} ${num}`
    aliases = [num, `acct ${num.slice(-4)}`]
    props.account_number = num
    props.routing_number = ROUTING[bankKey]
  } else {
    let i = iban(b.country, b.bban())
    while (forceCheck && i.slice(2, 4) !== forceCheck) i = iban(b.country, b.bban())
    display = spaced(i)
    aliases = [i]
    props.iban = i
  }
  add(id, 'Account', display, props, { jurisdiction: b.jur, aliases })
  const a: Acct = { id, bank: bankKey, holder, currency: b.currency, txns: [] }
  accounts.set(id, a)
  return a
}

// ---------------------------------------------------------------- transactions
const CHANNEL_TEXT: Record<string, string> = { wire: 'wire', cash: 'cash deposit', 'faster-payment': 'faster payment', sepa: 'SEPA transfer', ach: 'ACH transfer', chaps: 'CHAPS payment' }
const CHANNEL_LABEL: Record<string, string> = { wire: 'Wire', cash: 'Cash deposit', 'faster-payment': 'Faster payment', sepa: 'SEPA transfer', ach: 'ACH transfer', chaps: 'CHAPS payment' }
let txnSeq = 0
function txn(id: string, from: string | null, to: string, amount: number, currency: string, date: string, channel: string, reference: string, purpose: string): string {
  txnSeq++
  const ref = `TX-${date.replace(/-/g, '')}-${String(txnSeq).padStart(4, '0')}`
  const jur = (from ? byId.get(from) : byId.get(to))!.jurisdiction
  add(id, 'Transaction', `${CHANNEL_LABEL[channel]} ${longDate(date)} ${money(amount, currency)}`, { amount, currency, date, channel, reference, purpose, txn_ref: ref }, { jurisdiction: jur, aliases: [ref, reference] })
  if (from) accounts.get(from)!.txns.push({ txn: id, dir: 'out' })
  accounts.get(to)!.txns.push({ txn: id, dir: 'in' })
  return id
}
function channelFor(fromBank: Bank | null, toBank: Bank): string {
  if (!fromBank) return 'cash'
  if (fromBank.country !== toBank.country && !(fromBank.currency === 'EUR' && toBank.currency === 'EUR')) return 'wire'
  if (fromBank.currency === 'EUR') return 'sepa'
  if (fromBank.currency === 'GBP') return 'faster-payment'
  return 'ach'
}

// ---------------------------------------------------------------- people, companies, addresses
function person(id: string, name: string, jur: Jur, props: GNode['props'], aliases?: string[]) {
  return add(id, 'Person', name, props, { jurisdiction: jur, ...(aliases ? { aliases } : {}) })
}
function company(id: string, name: string, jur: Jur, props: GNode['props'], aliases: string[]) {
  return add(id, 'Company', name, props, { jurisdiction: jur, aliases })
}
function address(id: string, name: string, jur: Jur, props: GNode['props'], aliases?: string[]) {
  return add(id, 'Address', name, props, { jurisdiction: jur, ...(aliases ? { aliases } : {}) })
}

// ---------------------------------------------------------------- sanctions list
const sanctionsSec = doc('doc-sanctions-2026', 'sanctions', 'Consolidated sanctions list extract (fictional), September 2026 update', '2026-09-30')
const SANCTIONS: { id: string; name: string; aliases: string[]; type: string; props: GNode['props']; text: string }[] = [
  {
    id: 'san-saranoff', name: 'SARANOFF, Oleg Petrovich', aliases: ['Oleg Saranoff', 'Oleg Saranov', 'Oleg Petrovich Saranoff'], type: 'individual',
    props: { dob: '1968-11-02', nationality: 'RU', program: 'Eastern Trade Restrictions', listed_on: '2022-04-11', list_ref: 'ETR-0412' },
    text: 'SARANOFF, Oleg Petrovich, also known as Oleg Saranov, born 2 November 1968, was designated on 11 April 2022 under the Eastern Trade Restrictions programme. He is described as a procurement agent for state-linked shipping interests. All assets of the designated person are frozen and no funds may be made available to him, directly or indirectly.',
  },
  {
    id: 'san-tarvos', name: 'TARVOS, Anatoly Sergeyevich', aliases: ['Anatoly Tarvos', 'Anatoli Tarvos'], type: 'individual',
    props: { dob: '1961-03-27', nationality: 'RU', program: 'Eastern Trade Restrictions', listed_on: '2022-04-11', list_ref: 'ETR-0398' },
    text: 'TARVOS, Anatoly Sergeyevich, born 27 March 1961, was designated on 11 April 2022 as the controlling director of Volgamar Shipping. He is assessed to arrange vessel charters that circumvent trade restrictions. Listed persons are subject to an asset freeze and a travel ban.',
  },
  {
    id: 'san-volgamar', name: 'VOLGAMAR SHIPPING LTD', aliases: ['Volgamar Shipping', 'Volgamar Shipping Limited', 'Volgamar'], type: 'entity',
    props: { program: 'Eastern Trade Restrictions', listed_on: '2022-04-11', list_ref: 'ETR-E-0117', registered_country: 'GB' },
    text: 'VOLGAMAR SHIPPING LTD, a company registered in England and Wales, was designated on 11 April 2022. The entity is owned and controlled by TARVOS, Anatoly Sergeyevich and acts as a freight agent for restricted cargoes. Its stated address is Unit 4, 18 Harrow Wharf, London E14 9TQ.',
  },
  {
    id: 'san-northgate', name: 'NORTHGATE PETROCHEM FZE', aliases: ['Northgate Petrochem', 'Northgate Petrochem Ltd'], type: 'entity',
    props: { program: 'Illicit Oil Trade', listed_on: '2024-07-19', list_ref: 'IOT-E-0233', registered_country: 'AE' },
    text: 'NORTHGATE PETROCHEM FZE was designated on 19 July 2024 for brokering crude oil cargoes on behalf of restricted parties. A related company, Northgate Petrochem Ltd, is registered in the British Virgin Islands. Dealings with either company require a licence.',
  },
]
const sanctionSection = new Map<string, string>()
for (const s of SANCTIONS) {
  add(s.id, 'SanctionsEntry', s.name, { ...s.props, entry_type: s.type, list: 'Consolidated Sanctions List (fictional)' }, { aliases: s.aliases })
  sanctionSection.set(s.id, sanctionsSec(s.name, s.text))
}

// ---------------------------------------------------------------- activity sections (generated at the end)
interface KycOpts { docId: string; sec: (t: string, x: string) => string; note: string }
const kycByAccount = new Map<string, KycOpts>()
/** [alert, transaction, section] FLAGS edges whose transaction is created later. */
const pendingFlags: [string, string, string][] = []

/** KYC file for an account, with a due-diligence section that evidences HOLDS. */
function kycFile(acc: Acct, opened: string, cddText: string, note: string, docDate = opened): (t: string, x: string) => string {
  const b = BANKS[acc.bank]
  const docId = `doc-kyc-${acc.id.replace(/^acc-/, '')}`
  const sec = doc(docId, 'kyc', `KYC file: ${nameOf(acc.holder)} at ${b.name}`, docDate)
  const sid = sec('Customer due diligence', cddText)
  rel('HOLDS', acc.holder, acc.id, sid, conf(0.93, 0.99), { role: 'account holder', since: opened })
  kycByAccount.set(acc.id, { docId, sec, note })
  return sec
}

// ================================================================ SCENARIO 1: layered ownership
address('addr-harbor-view', '48 Harbor View Road, Suite 300, Wilmington, DE 19801', 'US', { city: 'Wilmington', postcode: '19801', country: 'US', kind: 'registered office' }, ['48 Harbor View Road'])
address('addr-cheapside-row', '3rd Floor, 27 Cheapside Row, London EC2V 6AJ', 'UK', { city: 'London', postcode: 'EC2V 6AJ', country: 'GB', kind: 'corporate services provider' }, ['27 Cheapside Row'])
address('addr-herengracht', 'Herengracht 512-B, 1017 CB Amsterdam', 'EU', { city: 'Amsterdam', postcode: '1017 CB', country: 'NL', kind: 'registered office' }, ['Herengracht 512-B'])
address('addr-seabreeze', 'Suite 7, Seabreeze Chambers, Road Town, Tortola VG1110', 'VG', { city: 'Road Town', postcode: 'VG1110', country: 'VG', kind: 'registered agent' }, ['Seabreeze Chambers'])
address('addr-halden-tallinn', 'Narva maantee 88-14, 10127 Tallinn', 'EU', { city: 'Tallinn', postcode: '10127', country: 'EE', kind: 'residential' })
address('addr-marlowe', 'Flat 9, 12 Elgin Crescent, London W11 2HX', 'UK', { city: 'London', postcode: 'W11 2HX', country: 'GB', kind: 'residential' })

company(S.MERIDIAN, S.MERIDIAN_NAME, 'US', { registry_no: '6614093', registry: 'Delaware Division of Corporations', incorporated: '2019-08-14', status: 'active', industry: 'Wholesale fasteners and marine fittings' }, ['Meridian Trade', 'Meridian'])
company('co-halvorsen-holdings', 'Halvorsen Holdings Ltd', 'UK', { registry_no: '11840265', registry: 'Companies House', incorporated: '2019-02-21', status: 'active', industry: 'Holding company' }, ['Halvorsen Holdings', 'Halvorsen'])
company('co-corvane-investments', 'Corvane Investments BV', 'EU', { registry_no: '72018833', registry: 'KvK (Netherlands)', incorporated: '2018-06-30', status: 'active', industry: 'Holding and group finance', country: 'NL' }, ['Corvane Investments', 'Corvane'])
company('co-blue-lantern', 'Blue Lantern Holdings Ltd', 'VG', { registry_no: '1987324', registry: 'BVI Registry of Corporate Affairs', incorporated: '2018-05-09', status: 'active', industry: 'Investment holding' }, ['Blue Lantern Holdings', 'Blue Lantern'])
person(S.UBO, S.UBO_NAME, 'EU', { dob: '1971-09-14', nationality: 'EE', occupation: 'Investor' }, ['V. Halden'])
person('per-ines-marlowe', 'Ines Marlowe', 'UK', { dob: '1983-01-30', nationality: 'GB', occupation: 'Private investor' })
person('per-thomas-reyburn', 'Thomas Reyburn', 'US', { dob: '1966-05-08', nationality: 'US', occupation: 'Company manager' })
person('per-clara-penhallow', 'Clara Penhallow', 'UK', { dob: '1958-12-03', nationality: 'GB', occupation: 'Professional director' })
address('addr-reyburn', '2214 Pelham Court, Newark, DE 19711', 'US', { city: 'Newark', postcode: '19711', country: 'US', kind: 'residential' })

{
  const sec = doc('doc-reg-meridian', 'registry', 'Delaware filing: Meridian Trade LLC (file 6614093)', '2025-06-02')
  const s1 = sec('Certificate of formation', 'Meridian Trade LLC was formed in Delaware on 14 August 2019 under file number 6614093. Its registered office is 48 Harbor View Road, Suite 300, Wilmington, DE 19801. The company describes its business as wholesale import of industrial fasteners and marine fittings.')
  const s2 = sec('Annual report: members and managers', 'The 2025 annual report lists Thomas Reyburn as the sole manager of Meridian Trade LLC. The sole member is Halvorsen Holdings Ltd, a private company registered in England and Wales, holding a 100 percent membership interest.')
  rel('INCORPORATED_IN', S.MERIDIAN, 'jur-us', s1, 0.99)
  rel('REGISTERED_AT', S.MERIDIAN, 'addr-harbor-view', s1, 0.98, { kind: 'registered office' })
  rel('DIRECTOR_OF', 'per-thomas-reyburn', S.MERIDIAN, s2, 0.97, { role: 'manager', appointed: '2019-08-14' })
  rel('OWNS', 'co-halvorsen-holdings', S.MERIDIAN, s2, 0.97, { pct: 100 })
}
{
  const sec = doc('doc-reg-halvorsen', 'registry', 'Companies House filing: Halvorsen Holdings Ltd (11840265)', '2025-09-18')
  const s1 = sec('Incorporation and registered office', 'Halvorsen Holdings Ltd was incorporated in England and Wales on 21 February 2019 with company number 11840265. Its registered office is 3rd Floor, 27 Cheapside Row, London EC2V 6AJ, an address used by a corporate services provider for several hundred companies.')
  const s2 = sec('Officers and people with significant control', 'Clara Penhallow is the sole director, appointed on incorporation. The register of people with significant control names Corvane Investments BV as a relevant legal entity holding 100 percent of the shares. No registrable individual is recorded.')
  rel('INCORPORATED_IN', 'co-halvorsen-holdings', 'jur-uk', s1, 0.99)
  rel('REGISTERED_AT', 'co-halvorsen-holdings', 'addr-cheapside-row', s1, 0.98, { kind: 'registered office' })
  rel('DIRECTOR_OF', 'per-clara-penhallow', 'co-halvorsen-holdings', s2, 0.98, { role: 'director', appointed: '2019-02-21' })
  rel('OWNS', 'co-corvane-investments', 'co-halvorsen-holdings', s2, 0.97, { pct: 100 })
}
{
  const sec = doc('doc-reg-corvane', 'registry', 'Dutch trade register extract: Corvane Investments BV (72018833)', '2025-07-07')
  const s1 = sec('Registration', 'Corvane Investments BV is entered in the Dutch trade register under number 72018833, with its seat in Amsterdam and its office at Herengracht 512-B, 1017 CB Amsterdam. Its stated activity is holding and financing of group companies.')
  const s2 = sec('Shareholder and UBO register', 'The sole shareholder of Corvane Investments BV is Blue Lantern Holdings Ltd of Road Town, Tortola. The UBO register entry, filed late in March 2025, names Viktor Halden as holding an indirect interest of more than 75 percent. Clara Penhallow is listed as managing director.')
  rel('INCORPORATED_IN', 'co-corvane-investments', 'jur-eu', s1, 0.99)
  rel('REGISTERED_AT', 'co-corvane-investments', 'addr-herengracht', s1, 0.97, { kind: 'registered office' })
  rel('OWNS', 'co-blue-lantern', 'co-corvane-investments', s2, 0.96, { pct: 100 })
  rel('DIRECTOR_OF', 'per-clara-penhallow', 'co-corvane-investments', s2, 0.95, { role: 'managing director', appointed: '2019-01-10' })
}
{
  const sec = doc('doc-agent-blue-lantern', 'kyc', 'Registered agent KYC file: Blue Lantern Holdings Ltd', '2025-11-04')
  const s1 = sec('Entity details', 'Blue Lantern Holdings Ltd is a BVI business company, number 1987324, incorporated on 9 May 2018. Its registered agent office is Suite 7, Seabreeze Chambers, Road Town, Tortola VG1110.')
  const s2 = sec('Beneficial ownership declaration', 'The register of members shows Viktor Halden holding 75 of 100 issued shares and Ines Marlowe holding the remaining 25. Mr Halden is declared as the ultimate beneficial owner and sole director. Ms Marlowe is described as a passive investor resident at Flat 9, 12 Elgin Crescent, London.')
  const s3 = sec('Certified identity documents', 'A certified copy of Viktor Halden\'s Estonian identity card was supplied, giving a residential address of Narva maantee 88-14, 10127 Tallinn. The certification was made by a notary in Tallinn in October 2025.')
  rel('INCORPORATED_IN', 'co-blue-lantern', 'jur-vg', s1, 0.99)
  rel('REGISTERED_AT', 'co-blue-lantern', 'addr-seabreeze', s1, 0.98, { kind: 'registered agent' })
  rel('OWNS', S.UBO, 'co-blue-lantern', s2, 0.94, { pct: 75 })
  rel('OWNS', 'per-ines-marlowe', 'co-blue-lantern', s2, 0.94, { pct: 25 })
  rel('DIRECTOR_OF', S.UBO, 'co-blue-lantern', s2, 0.93, { role: 'director', appointed: '2018-05-09' })
  rel('REGISTERED_AT', 'per-ines-marlowe', 'addr-marlowe', s2, 0.9, { kind: 'residential' })
  rel('REGISTERED_AT', S.UBO, 'addr-halden-tallinn', s3, 0.92, { kind: 'residential' })
}
const accMeridian = account('acc-meridian-us', 'harbor', S.MERIDIAN, '2019-09-03', 'business checking')
const accHalvorsen = account('acc-halvorsen-gb', 'kingsmere', 'co-halvorsen-holdings', '2019-04-11', 'business current')
const accBlueLantern = account('acc-blue-lantern-vg', 'tortola', 'co-blue-lantern', '2018-06-20', 'corporate deposit')
{
  const sec = kycFile(accMeridian, '2019-09-03', `Meridian Trade LLC opened a business checking account, number ${byId.get('acc-meridian-us')!.props.account_number}, with Harbor Federal Bank on 3 September 2019. The beneficial ownership certificate named Thomas Reyburn as the controlling person and stated that no individual owns 25 percent or more. Expected activity is USD 150,000 to 250,000 a month from US distributors.`, 'Outgoing fees to the UK parent rose sharply from January 2026 and exceed the profile given at onboarding.', '2026-01-20')
  const s2 = sec('Registered office and manager', 'The file records the registered office at 48 Harbor View Road, Suite 300, Wilmington, and Thomas Reyburn\'s home address at 2214 Pelham Court, Newark, DE 19711. Mr Reyburn signed the account mandate as sole authorised signatory.')
  rel('REGISTERED_AT', 'per-thomas-reyburn', 'addr-reyburn', s2, 0.91, { kind: 'residential' })
}
kycFile(accHalvorsen, '2019-04-11', 'Halvorsen Holdings Ltd opened a business current account with Kingsmere Bank on 11 April 2019, signed by its director Clara Penhallow. The stated purpose is receipt of management fees from group companies. Ms Penhallow holds directorships in more than 40 unrelated companies.', 'Funds received from Meridian Trade LLC are typically forwarded offshore within three business days.', '2025-12-02')
kycFile(accBlueLantern, '2018-06-20', 'Blue Lantern Holdings Ltd holds a US dollar corporate deposit account with Tortola Fiduciary Bank, opened on 20 June 2018 through its registered agent. Viktor Halden is the sole signatory. The declared source of funds is investment returns from European holdings.', 'Inflows come almost entirely from Halvorsen Holdings Ltd in the United Kingdom.', '2025-11-04')

const meridianFees: string[] = []
for (const [i, [d, amt]] of ([['2026-01-12', 238000], ['2026-02-10', 245500], ['2026-03-09', 231000], ['2026-04-13', 252750], ['2026-05-11', 219400], ['2026-06-08', 233350]] as [string, number][]).entries()) {
  meridianFees.push(txn(`txn-meridian-fee-${i + 1}`, 'acc-meridian-us', 'acc-halvorsen-gb', amt, 'USD', d, 'wire', `MGMT-FEE-2026-${String(i + 1).padStart(2, '0')}`, 'Management fee'))
  const out = Math.round(amt * 0.94 / 50) * 50
  const dt = addDays(d, int(1, 3))
  txn(`txn-halvorsen-out-${i + 1}`, 'acc-halvorsen-gb', 'acc-blue-lantern-vg', out, 'USD', dt, 'wire', `INTERCO-${dt.replace(/-/g, '')}`, 'Intercompany loan repayment')
}
add('case-2026-0117', 'Case', 'CASE-2026-0117 Meridian Trade LLC ownership review', { status: 'open', opened: '2026-04-22', priority: 'high', analyst: 'Rhea Imrie', typology: 'Layered ownership / opaque UBO' }, { jurisdiction: 'US', aliases: ['CASE-2026-0117', 'Meridian case'] })
{
  const sec = doc('doc-case-2026-0117', 'case-note', 'Case note CASE-2026-0117: Meridian Trade LLC ownership review', '2026-04-22')
  const s1 = sec('Summary', 'Meridian Trade LLC was escalated after Harbor Federal Bank could not reconcile its beneficial ownership certificate with registry records. The ownership chain runs from Meridian through Halvorsen Holdings Ltd in the UK and Corvane Investments BV in the Netherlands to Blue Lantern Holdings Ltd in the British Virgin Islands. Each intermediate layer is wholly owned, so Viktor Halden\'s 75 percent stake in Blue Lantern gives him an indirect 75 percent of Meridian.')
  const s2 = sec('Control assessment', 'Although Thomas Reyburn is the named manager, correspondence shows that payment instructions above USD 100,000 were approved by Viktor Halden by email. The analyst assesses that Mr Halden controls Meridian Trade LLC in addition to owning it. Confidence in the control finding is moderate because the emails came from a third party.')
  const s3 = sec('Funds flow', 'Between January and June 2026 Meridian paid about USD 1.42 million to Halvorsen Holdings as monthly management fees. Halvorsen forwarded roughly 94 percent of each payment to Blue Lantern\'s account at Tortola Fiduciary Bank within three days. Alert ALT-2026-0311-01 fired on the March onward wire under the high-risk corridor rule.')
  rel('SUBJECT_OF', S.MERIDIAN, 'case-2026-0117', s1, 0.97, { role: 'primary subject' })
  rel('SUBJECT_OF', S.UBO, 'case-2026-0117', s1, 0.9, { role: 'beneficial owner' })
  rel('CONTROLS', S.UBO, S.MERIDIAN, s2, 0.72, { basis: 'approval of payments' })
  rel('SUBJECT_OF', 'co-halvorsen-holdings', 'case-2026-0117', s3, 0.88, { role: 'intermediary' })
  add('alert-2026-0311-01', 'Alert', 'ALT-2026-0311-01 High-risk corridor wire', { rule: 'HIGH_RISK_CORRIDOR', reason: 'USD wire from a UK holding company to an offshore account within 3 days of an equal inbound wire from a US affiliate (pass-through pattern).', threshold: 200000, date: '2026-03-11', status: 'escalated', score: 82 }, { jurisdiction: 'UK', aliases: ['ALT-2026-0311-01'] })
  rel('FLAGS', 'alert-2026-0311-01', 'txn-halvorsen-out-3', s3, 0.95)
}

// ================================================================ SCENARIO 2: sanctions-evasion front
address(S.SHARED_ADDRESS, 'Unit 4, 18 Harrow Wharf, London E14 9TQ', 'UK', { city: 'London', postcode: 'E14 9TQ', country: 'GB', kind: 'registered office' }, ['18 Harrow Wharf', 'Harrow Wharf'])
address('addr-saranov-home', '7 Larkfield Mews, London SE10 8RP', 'UK', { city: 'London', postcode: 'SE10 8RP', country: 'GB', kind: 'residential' })
company(S.FRONT_COMPANY, S.FRONT_COMPANY_NAME, 'UK', { registry_no: '13377210', registry: 'Companies House', incorporated: '2021-04-12', status: 'active', industry: 'Commodity trading (fertiliser and metals)' }, ['Kestrel Bay Trading', 'Kestrel Bay'])
company(S.LISTED_PARTY, 'Volgamar Shipping Ltd', 'UK', { registry_no: '10944418', registry: 'Companies House', incorporated: '2017-09-03', status: 'active', industry: 'Freight forwarding' }, ['Volgamar Shipping', 'Volgamar'])
person(S.FRONT_DIRECTOR, S.FRONT_DIRECTOR_NAME, 'UK', { dob: '1968-11-02', nationality: 'GB', occupation: 'Company director' }, ['O Saranov'])
person('per-martin-ashdown', 'Martin Ashdown', 'UK', { dob: '1979-06-21', nationality: 'GB', occupation: 'Accountant' })
person('per-anatoly-tarvos', 'Anatoly Tarvos', 'UK', { dob: '1961-03-27', nationality: 'RU', occupation: 'Shipping executive' })
{
  const sec = doc('doc-reg-kestrel', 'registry', 'Companies House filing: Kestrel Bay Trading Ltd (13377210)', '2025-04-30')
  const s1 = sec('Incorporation and registered office', 'Kestrel Bay Trading Ltd was incorporated in England and Wales on 12 April 2021 with company number 13377210. The registered office is Unit 4, 18 Harrow Wharf, London E14 9TQ. Its nature of business is wholesale of fertilisers and non-ferrous metals.')
  const s2 = sec('Officers and people with significant control', 'Oleg Saranov, born November 1968, has been a director since incorporation, with Martin Ashdown appointed as a second director in June 2023. Oleg Saranov holds 51 percent of the shares and Martin Ashdown holds 49 percent. Mr Saranov gives his correspondence address as 7 Larkfield Mews, London SE10 8RP.')
  rel('INCORPORATED_IN', S.FRONT_COMPANY, 'jur-uk', s1, 0.99)
  rel('REGISTERED_AT', S.FRONT_COMPANY, S.SHARED_ADDRESS, s1, 0.98, { kind: 'registered office' })
  rel('DIRECTOR_OF', S.FRONT_DIRECTOR, S.FRONT_COMPANY, s2, 0.98, { role: 'director', appointed: '2021-04-12' })
  rel('DIRECTOR_OF', 'per-martin-ashdown', S.FRONT_COMPANY, s2, 0.97, { role: 'director', appointed: '2023-06-05' })
  rel('OWNS', S.FRONT_DIRECTOR, S.FRONT_COMPANY, s2, 0.97, { pct: 51 })
  rel('OWNS', 'per-martin-ashdown', S.FRONT_COMPANY, s2, 0.97, { pct: 49 })
  rel('REGISTERED_AT', S.FRONT_DIRECTOR, 'addr-saranov-home', s2, 0.9, { kind: 'correspondence' })
}
{
  const sec = doc('doc-reg-volgamar', 'registry', 'Companies House filing: Volgamar Shipping Ltd (10944418)', '2025-10-02')
  const s1 = sec('Incorporation and registered office', 'Volgamar Shipping Ltd was incorporated in England and Wales on 3 September 2017 with company number 10944418. In January 2024 the registered office moved to Unit 4, 18 Harrow Wharf, London E14 9TQ.')
  const s2 = sec('Officers and people with significant control', 'Anatoly Tarvos is the sole director and holds 100 percent of the shares. A notice on the file records that the company is subject to an asset freeze.')
  rel('INCORPORATED_IN', S.LISTED_PARTY, 'jur-uk', s1, 0.99)
  rel('REGISTERED_AT', S.LISTED_PARTY, S.SHARED_ADDRESS, s1, 0.98, { kind: 'registered office', since: '2024-01-15' })
  rel('DIRECTOR_OF', 'per-anatoly-tarvos', S.LISTED_PARTY, s2, 0.98, { role: 'director', appointed: '2017-09-03' })
  rel('OWNS', 'per-anatoly-tarvos', S.LISTED_PARTY, s2, 0.98, { pct: 100 })
}
const accKestrel = account(S.FRONT_ACCOUNT, 'thamesgate', S.FRONT_COMPANY, '2021-05-20', 'business current', '29')
const accVolgamar = account('acc-volgamar-cy', 'limassol', S.LISTED_PARTY, '2019-02-14', 'business current')
kycFile(accKestrel, '2021-05-20', `Kestrel Bay Trading Ltd opened a business current account with Thamesgate Bank on 20 May 2021, IBAN ${byId.get(S.FRONT_ACCOUNT)!.name}. Expected turnover was declared as GBP 60,000 a month from UK agricultural buyers. Director Oleg Saranov presented a British passport with date of birth 2 November 1968.`, 'Outgoing payments to a Cyprus account of Volgamar Shipping Ltd are inconsistent with the declared fertiliser trade.', '2026-03-16')
kycFile(accVolgamar, '2019-02-14', 'Volgamar Shipping Ltd holds a euro business account with Limassol Maritime Bank, opened on 14 February 2019 and signed by Anatoly Tarvos. The account was restricted in April 2022 but the restriction was lifted in error after a data migration in 2025.', 'Inbound funds from Kestrel Bay Trading Ltd began in February 2026.', '2026-03-20')
txn('txn-kestrel-0206', S.FRONT_ACCOUNT, 'acc-volgamar-cy', 92000, 'GBP', '2026-02-06', 'wire', 'FRT-PREPAY-0206', 'Freight prepayment')
txn('txn-kestrel-0224', S.FRONT_ACCOUNT, 'acc-volgamar-cy', 118750, 'GBP', '2026-02-24', 'wire', 'FRT-PREPAY-0224', 'Freight prepayment')
txn(S.ALERTED_TXN, S.FRONT_ACCOUNT, 'acc-volgamar-cy', 486500, 'GBP', '2026-03-14', 'wire', 'FRT-PREPAY-0314', 'Freight prepayment')
add('case-2026-0142', 'Case', 'CASE-2026-0142 Kestrel Bay Trading sanctions exposure', { status: 'open', opened: '2026-03-18', priority: 'critical', analyst: 'Tomas Lindqvist', typology: 'Sanctions evasion via front company' }, { jurisdiction: 'UK', aliases: ['CASE-2026-0142', 'Kestrel Bay case'] })
{
  const sec = doc('doc-case-2026-0142', 'case-note', 'Case note CASE-2026-0142: Kestrel Bay Trading sanctions exposure', '2026-03-18')
  const s1 = sec('Screening result', 'Name screening of Kestrel Bay\'s directors returned a fuzzy match between director Oleg Saranov and listed person SARANOFF, Oleg Petrovich, with a score of 0.87. The date of birth on the Kestrel Bay KYC file agrees with the listing, while the transliteration of the surname differs. The analyst treats the match as probable pending passport verification.')
  const s2 = sec('Shared address with a listed party', 'Kestrel Bay Trading Ltd and Volgamar Shipping Ltd both use Unit 4, 18 Harrow Wharf, London E14 9TQ as their registered office. Volgamar Shipping Ltd matches the listed entity VOLGAMAR SHIPPING LTD with a score of 0.97. Its director Anatoly Tarvos matches listed person TARVOS, Anatoly Sergeyevich with a score of 0.94.')
  const s3 = sec('Payments to the listed party', 'On 14 March 2026 Kestrel Bay wired GBP 486,500.00 from its Thamesgate Bank account to a Cyprus account held by Volgamar Shipping Ltd, described as a freight prepayment. Two smaller wires on 6 and 24 February 2026 followed the same route. The analyst recommends exiting the relationship and filing a suspicious activity report.')
  rel('MATCHES', S.FRONT_DIRECTOR, 'san-saranoff', s1, 0.88, { score: 0.87, method: 'fuzzy name + date of birth' })
  rel('SUBJECT_OF', S.FRONT_COMPANY, 'case-2026-0142', s1, 0.97, { role: 'primary subject' })
  rel('SUBJECT_OF', S.FRONT_DIRECTOR, 'case-2026-0142', s1, 0.95, { role: 'director' })
  rel('MATCHES', S.LISTED_PARTY, 'san-volgamar', s2, 0.97, { score: 0.97, method: 'exact name + address' })
  rel('MATCHES', 'per-anatoly-tarvos', 'san-tarvos', s2, 0.93, { score: 0.94, method: 'fuzzy name + date of birth' })
  rel('SUBJECT_OF', S.LISTED_PARTY, 'case-2026-0142', s2, 0.92, { role: 'counterparty' })
  rel('SUBJECT_OF', S.FRONT_ACCOUNT, 'case-2026-0142', s3, 0.95, { role: 'originating account' })
}
{
  const sec = doc('doc-sar-kestrel', 'sar', 'SAR narrative: Kestrel Bay Trading Ltd (Thamesgate Bank)', '2026-03-20')
  sec('Grounds for suspicion', 'Thamesgate Bank suspects that Kestrel Bay Trading Ltd is being used to move funds to a designated entity. The beneficiary of the 14 March 2026 wire, Volgamar Shipping Ltd, is on the consolidated list, and Kestrel Bay\'s director closely matches another listed person. A defence against money laundering was requested before a further pending payment of GBP 210,000.00 is released.')
  const s2 = sec('Alert details', 'Alert ALT-2026-0314-01 fired on the 14 March wire under the sanctions proximity rule, which triggers when a counterparty or one of its officers scores 0.80 or more against the list. Alert ALT-2026-0314-02 fired on the same wire because it exceeded the high-value threshold of GBP 250,000 for a customer of this size.')
  const s3 = sec('Earlier activity', 'The February wires of GBP 92,000.00 and GBP 118,750.00 to the same beneficiary did not alert because the counterparty screening list had not yet been refreshed. They are included in this report for completeness.')
  add('alert-2026-0314-01', 'Alert', 'ALT-2026-0314-01 Sanctions proximity', { rule: 'SANCTIONS_PROXIMITY', reason: 'Beneficiary Volgamar Shipping Ltd matches a listed entity (score 0.97) and the originator\'s director fuzzy-matches SARANOFF, Oleg Petrovich (score 0.87).', threshold: 0.8, date: '2026-03-14', status: 'escalated', score: 97 }, { jurisdiction: 'UK', aliases: ['ALT-2026-0314-01'] })
  add('alert-2026-0314-02', 'Alert', 'ALT-2026-0314-02 High-value wire', { rule: 'HIGH_VALUE_WIRE', reason: 'Single outbound wire of GBP 486,500.00 is more than eight times the declared monthly turnover.', threshold: 250000, date: '2026-03-14', status: 'escalated', score: 74 }, { jurisdiction: 'UK', aliases: ['ALT-2026-0314-02'] })
  rel('FLAGS', 'alert-2026-0314-01', S.ALERTED_TXN, s2, 0.99)
  rel('FLAGS', 'alert-2026-0314-02', S.ALERTED_TXN, s2, 0.99)
  rel('SUBJECT_OF', 'acc-volgamar-cy', 'case-2026-0142', s3, 0.9, { role: 'beneficiary account' })
}

// ================================================================ SCENARIO 3: money-mule ring
address('addr-cobden', 'Flat 2, 41 Cobden Street, Leeds LS6 1QR', 'UK', { city: 'Leeds', postcode: 'LS6 1QR', country: 'GB', kind: 'residential (HMO)' }, ['41 Cobden Street', 'Cobden Street'])
address('addr-ashville', '17 Ashville Terrace, Leeds LS6 1LZ', 'UK', { city: 'Leeds', postcode: 'LS6 1LZ', country: 'GB', kind: 'residential' }, ['17 Ashville Terrace'])
address('addr-kirkstall', 'Office 12, 90 Kirkstall Road, Leeds LS3 1LT', 'UK', { city: 'Leeds', postcode: 'LS3 1LT', country: 'GB', kind: 'virtual office' }, ['90 Kirkstall Road'])
address('addr-coral-bay', 'Coral Bay House, Main Street, Road Town, Tortola VG1110', 'VG', { city: 'Road Town', postcode: 'VG1110', country: 'VG', kind: 'registered agent' }, ['Coral Bay House'])
add(S.MULE_DEVICE, 'Device', 'Android handset (fingerprint 7f3a9c21)', { type: 'mobile', os: 'Android 14', fingerprint: '7f3a9c21e04b', first_seen: '2025-12-03', ip_city: 'Leeds' }, { aliases: ['7f3a9c21', 'device 7f3a9c21'] })
company(S.COLLECTOR_HOLDER, 'Brightwell Courier Services Ltd', 'UK', { registry_no: '14402871', registry: 'Companies House', incorporated: '2025-10-02', status: 'active', industry: 'Courier services' }, ['Brightwell Courier Services', 'Brightwell Courier', 'Brightwell'])
company('co-sable-reef', 'Sable Reef Ventures Ltd', 'VG', { registry_no: '2117846', registry: 'BVI Registry of Corporate Affairs', incorporated: '2025-08-19', status: 'active', industry: 'Investment holding' }, ['Sable Reef Ventures', 'Sable Reef'])
person('per-darius-kell', 'Darius Kell', 'UK', { dob: '1988-02-11', nationality: 'GB', occupation: 'Company director' })
const MULES: [string, string, string, string, string][] = [
  ['per-jordan-pryce', 'Jordan Pryce', '2005-06-14', 'addr-cobden', '2025-12-05'],
  ['per-kayla-mensah', 'Kayla Mensah', '2004-10-02', 'addr-cobden', '2025-12-09'],
  ['per-liam-ostrowski', 'Liam Ostrowski', '2006-01-23', 'addr-cobden', '2025-12-15'],
  ['per-ryan-doherty', 'Ryan Doherty', '2003-08-30', 'addr-ashville', '2026-01-06'],
  ['per-aisha-bello', 'Aisha Bello', '2005-03-17', 'addr-ashville', '2026-01-08'],
]
{
  const sec = doc('doc-reg-brightwell', 'registry', 'Companies House filing: Brightwell Courier Services Ltd (14402871)', '2025-10-02')
  const s1 = sec('Incorporation and registered office', 'Brightwell Courier Services Ltd was incorporated in England and Wales on 2 October 2025 with company number 14402871. Its registered office is Office 12, 90 Kirkstall Road, Leeds LS3 1LT, a virtual office provider.')
  const s2 = sec('Officers and people with significant control', 'Darius Kell is the sole director and holds 100 percent of the shares. No accounts have yet been filed.')
  rel('INCORPORATED_IN', S.COLLECTOR_HOLDER, 'jur-uk', s1, 0.99)
  rel('REGISTERED_AT', S.COLLECTOR_HOLDER, 'addr-kirkstall', s1, 0.98, { kind: 'registered office' })
  rel('DIRECTOR_OF', 'per-darius-kell', S.COLLECTOR_HOLDER, s2, 0.98, { role: 'director', appointed: '2025-10-02' })
  rel('OWNS', 'per-darius-kell', S.COLLECTOR_HOLDER, s2, 0.98, { pct: 100 })
}
const accCollector = account(S.COLLECTOR, 'kingsmere', S.COLLECTOR_HOLDER, '2025-10-20', 'business current')
const accSable = account('acc-sable-reef-vg', 'tortola', 'co-sable-reef', '2025-09-02', 'corporate deposit')
kycFile(accCollector, '2025-10-20', 'Brightwell Courier Services Ltd opened a business current account with Kingsmere Bank on 20 October 2025, signed by its director Darius Kell. The declared business is same-day parcel delivery in West Yorkshire with expected turnover of GBP 15,000 a month. No trading website or vehicle fleet could be found.', 'Inbound faster payments from personal accounts at Thamesgate Bank are swept offshore within days.', '2026-03-28')
{
  const sec = kycFile(accSable, '2025-09-02', 'Sable Reef Ventures Ltd, BVI company number 2117846, opened a US dollar deposit account with Tortola Fiduciary Bank on 2 September 2025. Its registered agent office is Coral Bay House, Main Street, Road Town, Tortola VG1110. The sole shareholder and signatory is Darius Kell of Leeds.', 'All inflows to date originate from Brightwell Courier Services Ltd.', '2026-04-02')
  const s2 = sec('Ownership declaration', 'The register of members records Darius Kell as owner of all 50,000 issued shares in Sable Reef Ventures Ltd. He is also the sole director.')
  const s1 = kycByAccount.get('acc-sable-reef-vg')!.docId + '-s1'
  rel('INCORPORATED_IN', 'co-sable-reef', 'jur-vg', s1, 0.97)
  rel('REGISTERED_AT', 'co-sable-reef', 'addr-coral-bay', s1, 0.96, { kind: 'registered agent' })
  rel('OWNS', 'per-darius-kell', 'co-sable-reef', s2, 0.95, { pct: 100 })
  rel('DIRECTOR_OF', 'per-darius-kell', 'co-sable-reef', s2, 0.95, { role: 'director', appointed: '2025-08-19' })
}
const muleDeposits: string[][] = []
for (const [i, [pid, name, dob, addr, opened]] of MULES.entries()) {
  person(pid, name, 'UK', { dob, nationality: 'GB', occupation: i % 2 ? 'Student' : 'Part-time warehouse worker' })
  const accId = S.MULE_ACCOUNTS[i]
  const acc = account(accId, 'thamesgate', pid, opened, 'personal current')
  const addrName = nameOf(addr)
  const sec = kycFile(acc, opened, `${name}, born ${longDate(dob)}, opened a personal current account, IBAN ${byId.get(accId)!.name}, through the Thamesgate mobile app on ${longDate(opened)}. The customer gave a residential address of ${addrName}. Declared income is under GBP 9,000 a year.`, 'Cash deposits just under GBP 10,000 are followed within two days by a single outbound faster payment to Brightwell Courier Services Ltd.', '2026-03-25')
  const s1 = kycByAccount.get(accId)!.docId + '-s1'
  rel('REGISTERED_AT', pid, addr, s1, 0.93, { kind: 'residential' })
  const s2 = sec('Digital footprint', `Online banking sessions for this account came from the Android handset with fingerprint 7f3a9c21. The same handset logged into four other Thamesgate retail accounts between December 2025 and March 2026. Login IP addresses resolve to Leeds.`)
  rel('USED_DEVICE', accId, S.MULE_DEVICE, s2, 0.96, { first_seen: opened, sessions: int(14, 41) })
  // structured cash deposits, then a sweep to the collector
  const deps: string[] = []
  let total = 0
  const n = i === 2 ? 3 : 2
  let d = randDate('2026-02-02', '2026-02-06')
  for (let k = 0; k < n; k++) {
    const amt = int(90, 99) * 100 + pick([0, 50])
    deps.push(txn(`txn-mule-${i + 1}-dep-${k + 1}`, null, accId, amt, 'GBP', d, 'cash', `BRANCH-${pick(['LEEDS-HEADROW', 'LEEDS-BRIGGATE', 'BRADFORD-MARKET', 'WAKEFIELD-WESTGATE'])}`, 'Cash deposit'))
    total += amt
    d = addDays(d, int(3, 5))
  }
  const lastDeposit = String(byId.get(deps[deps.length - 1])!.props.date)
  muleDeposits.push(deps)
  const sweep = Math.round((total - int(250, 400)) / 10) * 10
  txn(`txn-mule-${i + 1}-sweep`, accId, S.COLLECTOR, sweep, 'GBP', addDays(lastDeposit, int(1, 2)), 'faster-payment', pick(['parcel refund', 'deliveries', 'stock', 'invoice']), 'Onward payment')
}
txn('txn-collector-out-1', S.COLLECTOR, 'acc-sable-reef-vg', 61200, 'GBP', '2026-03-12', 'wire', 'CONSULTANCY-Q1', 'Consultancy fee')
txn('txn-collector-out-2', S.COLLECTOR, 'acc-sable-reef-vg', 38400, 'GBP', '2026-03-27', 'wire', 'CONSULTANCY-Q1B', 'Consultancy fee')
add('case-2026-0209', 'Case', 'CASE-2026-0209 Thamesgate mule network (structured cash)', { status: 'open', opened: '2026-03-30', priority: 'high', analyst: 'Nadia Okonjo', typology: 'Money mules / structuring' }, { jurisdiction: 'UK', aliases: ['CASE-2026-0209', 'mule case', 'mule ring'] })
{
  const sec = doc('doc-case-2026-0209', 'case-note', 'Case note CASE-2026-0209: Thamesgate mule network', '2026-03-30')
  const s1 = sec('Network summary', 'Five young retail customers of Thamesgate Bank opened accounts within five weeks of each other and share one Android handset for online banking. Three live at Flat 2, 41 Cobden Street and two at 17 Ashville Terrace, both in Leeds LS6. Each account received cash deposits between GBP 9,000 and GBP 9,950, just under the bank\'s GBP 10,000 cash review threshold.')
  const s2 = sec('Collector account', 'Within days of each deposit cycle, every account sent a single faster payment to Brightwell Courier Services Ltd at Kingsmere Bank. Brightwell, controlled by Darius Kell, then wired GBP 99,600.00 in two payments to Sable Reef Ventures Ltd in the British Virgin Islands. Mr Kell owns Sable Reef, so the funds return to him through an offshore layer.')
  for (const a of S.MULE_ACCOUNTS) rel('SUBJECT_OF', a, 'case-2026-0209', s1, 0.95, { role: 'mule account' })
  rel('SUBJECT_OF', S.COLLECTOR, 'case-2026-0209', s2, 0.95, { role: 'collector account' })
  rel('SUBJECT_OF', 'per-darius-kell', 'case-2026-0209', s2, 0.9, { role: 'suspected controller' })
  rel('CONTROLS', 'per-darius-kell', S.COLLECTOR_HOLDER, s2, 0.85, { basis: 'sole director and shareholder' })
}
{
  const sec = doc('doc-sar-mule', 'sar', 'SAR narrative: structured cash deposits and collector account (Thamesgate Bank)', '2026-04-03')
  sec('Grounds for suspicion', 'Thamesgate Bank suspects that five retail accounts are operated as money-mule accounts on behalf of a third party. The pattern of cash deposits just below GBP 10,000, a shared device and immediate onward payment to one business account is not consistent with the customers\' declared incomes.')
  const s2 = sec('Structuring alerts', 'Structuring alerts ALT-2026-0220-01 to ALT-2026-0220-05 fired once each account had received two or more cash deposits between GBP 9,000 and GBP 9,999 within 30 days. The rule threshold is GBP 10,000 aggregated per customer per rolling 30 days.')
  const s3 = sec('Pass-through alert', 'Kingsmere Bank raised alert ALT-2026-0312-07 on the GBP 61,200.00 wire from Brightwell Courier Services Ltd to the British Virgin Islands. More than 90 percent of the inbound value had left the account within ten days of arrival.')
  for (const [i, deps] of muleDeposits.entries()) {
    const id = `alert-2026-0220-0${i + 1}`
    add(id, 'Alert', `ALT-2026-0220-0${i + 1} Structured cash deposits`, { rule: 'STRUCTURING_BELOW_10K', reason: `${deps.length} cash deposits between GBP 9,000 and GBP 9,999 within 30 days on a newly opened retail account.`, threshold: 10000, date: '2026-02-20', status: 'escalated', score: 88 - i }, { jurisdiction: 'UK', aliases: [`ALT-2026-0220-0${i + 1}`] })
    for (const t of deps) rel('FLAGS', id, t, s2, 0.97)
  }
  add('alert-2026-0312-07', 'Alert', 'ALT-2026-0312-07 Rapid pass-through', { rule: 'RAPID_PASS_THROUGH', reason: 'Over 90% of inbound value moved offshore within 10 days of receipt.', threshold: 0.9, date: '2026-03-12', status: 'escalated', score: 79 }, { jurisdiction: 'UK', aliases: ['ALT-2026-0312-07'] })
  rel('FLAGS', 'alert-2026-0312-07', 'txn-collector-out-1', s3, 0.96)
}

// ================================================================ SCENARIO 4: benign look-alikes
address('addr-saranova', '22 Cotham Vale, Bristol BS6 6HR', 'UK', { city: 'Bristol', postcode: 'BS6 6HR', country: 'GB', kind: 'residential' })
address('addr-northgate-houston', '9100 Westpark Drive, Suite 400, Houston, TX 77063', 'US', { city: 'Houston', postcode: '77063', country: 'US', kind: 'head office' }, ['9100 Westpark Drive'])
address('addr-volgamar-seafoods', 'Grosser Grasbrook 31, 20457 Hamburg', 'EU', { city: 'Hamburg', postcode: '20457', country: 'DE', kind: 'registered office' })
address('addr-harbourline', '2nd Floor, Harbourline Building, Wickhams Cay II, Road Town, Tortola VG1110', 'VG', { city: 'Road Town', postcode: 'VG1110', country: 'VG', kind: 'registered agent' }, ['Harbourline Building'])
person('per-olga-saranova', 'Olga Saranova', 'UK', { dob: '1991-07-17', nationality: 'GB', occupation: 'Primary school teacher' })
company('co-northgate-petroleum', 'Northgate Petroleum Services Inc', 'US', { registry_no: '0801447392', registry: 'Texas Secretary of State', incorporated: '2004-03-22', status: 'active', industry: 'Oilfield equipment servicing' }, ['Northgate Petroleum Services', 'Northgate Petroleum'])
company('co-volgamar-seafoods', 'Volgamar Seafoods GmbH', 'EU', { registry_no: 'HRB 148223', registry: 'Handelsregister Hamburg', incorporated: '2011-05-16', status: 'active', industry: 'Seafood import and wholesale', country: 'DE' }, ['Volgamar Seafoods'])
company('co-northgate-petrochem', 'Northgate Petrochem Ltd', 'VG', { registry_no: '1874402', registry: 'BVI Registry of Corporate Affairs', incorporated: '2016-11-08', status: 'struck off', industry: 'Petroleum brokerage' }, ['Northgate Petrochem'])
person('per-hal-brennan', 'Hal Brennan', 'US', { dob: '1959-04-04', nationality: 'US', occupation: 'Chief executive' })
person('per-dana-whitcombe', 'Dana Whitcombe', 'US', { dob: '1970-10-19', nationality: 'US', occupation: 'Chief financial officer' })
person('per-jens-albrecht', 'Jens Albrecht', 'EU', { dob: '1965-02-08', nationality: 'DE', occupation: 'Managing director' })
person('per-maren-albrecht', 'Maren Albrecht', 'EU', { dob: '1968-07-25', nationality: 'DE', occupation: 'Business owner' })
{
  const acc = account('acc-saranova-gb', 'kingsmere', 'per-olga-saranova', '2024-09-03', 'personal current')
  const sec = kycFile(acc, '2024-09-03', 'Olga Saranova, born 17 July 1991, a primary school teacher, opened a personal current account with Kingsmere Bank on 3 September 2024. Her address is 22 Cotham Vale, Bristol BS6 6HR, verified against a council tax bill. Salary is paid monthly by Bristol City Council.', 'Activity is limited to salary, rent and household spending.', '2024-09-03')
  rel('REGISTERED_AT', 'per-olga-saranova', 'addr-saranova', kycByAccount.get(acc.id)!.docId + '-s1', 0.95, { kind: 'residential' })
  const s2 = sec('Screening disposition', 'Onboarding screening produced a weak hit against SARANOFF, Oleg Petrovich with a score of 0.41, driven by surname similarity only. Gender, date of birth and nationality all differ from the listing, so the hit was discounted as a false positive. No further action is required.')
  rel('MATCHES', 'per-olga-saranova', 'san-saranoff', s2, 0.95, { score: 0.41, method: 'fuzzy name', disposition: 'false positive' })
}
add('case-2026-0233', 'Case', 'CASE-2026-0233 Screening false positives review', { status: 'closed', opened: '2026-06-11', closed: '2026-06-19', priority: 'low', analyst: 'Rhea Imrie', typology: 'Screening quality assurance' }, { jurisdiction: 'US', aliases: ['CASE-2026-0233'] })
{
  const sec = doc('doc-reg-northgate-petroleum', 'registry', 'Texas filing: Northgate Petroleum Services Inc (0801447392)', '2025-03-14')
  const s1 = sec('Certificate of formation', 'Northgate Petroleum Services Inc was incorporated in Texas on 22 March 2004 under filing number 0801447392. Its principal office is 9100 Westpark Drive, Suite 400, Houston, TX 77063. The company repairs and certifies wellhead and pressure-control equipment.')
  const s2 = sec('Officers and shareholders', 'Hal Brennan is president and a director, and Dana Whitcombe is treasurer and a director. Hal Brennan holds 70 percent of the common stock and Dana Whitcombe holds 30 percent.')
  rel('INCORPORATED_IN', 'co-northgate-petroleum', 'jur-us', s1, 0.99)
  rel('REGISTERED_AT', 'co-northgate-petroleum', 'addr-northgate-houston', s1, 0.98, { kind: 'principal office' })
  rel('DIRECTOR_OF', 'per-hal-brennan', 'co-northgate-petroleum', s2, 0.97, { role: 'president', appointed: '2004-03-22' })
  rel('DIRECTOR_OF', 'per-dana-whitcombe', 'co-northgate-petroleum', s2, 0.97, { role: 'treasurer', appointed: '2012-01-09' })
  rel('OWNS', 'per-hal-brennan', 'co-northgate-petroleum', s2, 0.96, { pct: 70 })
  rel('OWNS', 'per-dana-whitcombe', 'co-northgate-petroleum', s2, 0.96, { pct: 30 })
}
{
  const sec = doc('doc-reg-volgamar-seafoods', 'registry', 'Handelsregister extract: Volgamar Seafoods GmbH (HRB 148223)', '2025-05-20')
  const s1 = sec('Registration', 'Volgamar Seafoods GmbH is registered with the Hamburg local court under HRB 148223 since 16 May 2011. Its seat is Grosser Grasbrook 31, 20457 Hamburg. The company imports and distributes frozen fish from Norway and Iceland.')
  const s2 = sec('Managing directors and shareholders', 'Jens Albrecht is the managing director. The shareholders are Jens Albrecht with 60 percent and Maren Albrecht with 40 percent. The company name combines the founders\' former vessel, the Volga, with the Latin word for sea.')
  rel('INCORPORATED_IN', 'co-volgamar-seafoods', 'jur-eu', s1, 0.99)
  rel('REGISTERED_AT', 'co-volgamar-seafoods', 'addr-volgamar-seafoods', s1, 0.98, { kind: 'registered office' })
  rel('DIRECTOR_OF', 'per-jens-albrecht', 'co-volgamar-seafoods', s2, 0.97, { role: 'managing director', appointed: '2011-05-16' })
  rel('OWNS', 'per-jens-albrecht', 'co-volgamar-seafoods', s2, 0.97, { pct: 60 })
  rel('OWNS', 'per-maren-albrecht', 'co-volgamar-seafoods', s2, 0.97, { pct: 40 })
}
{
  const sec = doc('doc-reg-northgate-petrochem', 'registry', 'BVI registry search: Northgate Petrochem Ltd (1874402)', '2025-08-12')
  const s1 = sec('Search result', 'Northgate Petrochem Ltd, BVI company number 1874402, was incorporated on 8 November 2016 and was struck off in 2025 for non-payment of fees. Its last registered agent office was 2nd Floor, Harbourline Building, Wickhams Cay II, Road Town, Tortola VG1110.')
  const s2 = sec('List match', 'The company name and registered agent agree with the related-entity note in the listing for NORTHGATE PETROCHEM FZE. Screening treats this as a strong match with a score of 0.92.')
  rel('INCORPORATED_IN', 'co-northgate-petrochem', 'jur-vg', s1, 0.98)
  rel('REGISTERED_AT', 'co-northgate-petrochem', 'addr-harbourline', s1, 0.95, { kind: 'registered agent' })
  rel('MATCHES', 'co-northgate-petrochem', 'san-northgate', s2, 0.9, { score: 0.92, method: 'name + related-entity note' })
}
const accNorthgate = account('acc-northgate-us', 'prairie', 'co-northgate-petroleum', '2006-07-12', 'business checking')
const accSeafoods = account('acc-volgamar-seafoods-de', 'rheinhafen', 'co-volgamar-seafoods', '2011-06-01', 'business current')
{
  const sec = kycFile(accNorthgate, '2006-07-12', 'Northgate Petroleum Services Inc has banked with Prairie First Bank since 12 July 2006. The 2025 refresh of beneficial ownership names Hal Brennan (70 percent) and Dana Whitcombe (30 percent). Annual turnover is about USD 38 million from US oilfield operators.', 'Large wires correspond to equipment purchase orders on file.', '2025-02-10')
  const s2 = sec('Alert disposition', 'Alert ALT-2026-0611-02 fired on an incoming EUR 412,000.00 wire because the beneficiary name shares the word Northgate with the listed entity NORTHGATE PETROCHEM FZE. The two companies have unrelated registration numbers, addresses and officers. The alert was closed as a false positive on 19 June 2026.')
  rel('SUBJECT_OF', 'co-northgate-petroleum', 'case-2026-0233', s2, 0.93, { role: 'cleared subject' })
  add('alert-2026-0611-02', 'Alert', 'ALT-2026-0611-02 Watch-list name similarity', { rule: 'WATCHLIST_NAME_SIMILARITY', reason: 'Beneficiary name shares the token NORTHGATE with listed entity NORTHGATE PETROCHEM FZE (token similarity 0.34, threshold 0.30); cleared as an unrelated company.', threshold: 0.3, date: '2026-06-11', status: 'closed-false-positive', score: 34 }, { jurisdiction: 'US', aliases: ['ALT-2026-0611-02'] })
  // the flagged wire is created with the ordinary transactions below
  pendingFlags.push(['alert-2026-0611-02', 'txn-northgate-0611', s2])
}
kycFile(accSeafoods, '2011-06-01', 'Volgamar Seafoods GmbH holds a euro business account with Rheinhafen Bank, opened on 1 June 2011 and signed by Jens Albrecht. Name screening returned no hit above the 0.50 review threshold, and a manual check confirmed no link to Volgamar Shipping Ltd. Expected turnover is EUR 1.5 million a month from fish wholesalers.', 'Payments go to Nordic suppliers and come from German retailers.', '2025-05-20')
{
  const sec = doc('doc-case-2026-0233', 'case-note', 'Case note CASE-2026-0233: screening false positives review', '2026-06-19')
  sec('Purpose', 'This quality review sampled screening hits closed as false positives in the first half of 2026. It confirms that three customers with names resembling listed parties are unrelated to them.')
  const s2 = sec('Findings', 'Olga Saranova of Bristol differs from SARANOFF, Oleg Petrovich in gender, birth date and nationality. Volgamar Seafoods GmbH of Hamburg has no officers, owners or addresses in common with Volgamar Shipping Ltd. Northgate Petroleum Services Inc of Houston is unrelated to NORTHGATE PETROCHEM FZE.')
  rel('SUBJECT_OF', 'per-olga-saranova', 'case-2026-0233', s2, 0.94, { role: 'cleared subject' })
  rel('SUBJECT_OF', 'co-volgamar-seafoods', 'case-2026-0233', s2, 0.94, { role: 'cleared subject' })
}

// ================================================================ ordinary world
const FIRST = ['Amelia', 'Benedict', 'Carys', 'Declan', 'Elif', 'Felix', 'Greta', 'Hamid', 'Imogen', 'Joaquin', 'Kirsten', 'Lorcan', 'Mariela', 'Niamh', 'Osric', 'Philippa', 'Quentin', 'Rosalind', 'Soren', 'Talia', 'Ulrich', 'Vera', 'Wendell', 'Ximena', 'Yusuf', 'Zofia', 'Anouk', 'Bastian', 'Celeste', 'Dorian', 'Esme', 'Fintan', 'Giada', 'Henrik', 'Isolde', 'Jasper', 'Leandra', 'Matthias', 'Noemi', 'Pascal']
const LAST = ['Abernathy', 'Bramwell', 'Castellan', 'Delacroix', 'Eastwood', 'Fairbairn', 'Galloway', 'Hartigan', 'Ingersoll', 'Jaramillo', 'Kowalczyk', 'Lindgren', 'McAllister', 'Nakamura', 'Okonkwo', 'Pelletier', 'Quigley', 'Ravenscroft', 'Sandoval', 'Thorne', 'Underhill', 'Vasquez', 'Wetherby', 'Yilmaz', 'Zielinski', 'Ashcombe', 'Brannigan', 'Cardew', 'Dunleavy', 'Everard', 'Fenwick', 'Gilchrist', 'Holloway', 'Iversen', 'Kettering', 'Lambourne', 'Merriweather', 'Northcote', 'Penrose', 'Stanhope']
const NAT: Record<Jur, string[]> = { US: ['US'], UK: ['GB'], EU: ['DE', 'NL', 'FR', 'IT', 'IE'], VG: ['VG', 'GB'] }
const OCCUPATIONS = ['Company director', 'Engineer', 'Accountant', 'Entrepreneur', 'Sales director', 'Operations manager', 'Retired', 'Architect', 'Consultant', 'Solicitor', 'Investor']
const PREFIX = ['Ashgrove', 'Brackenridge', 'Calder', 'Dunmore', 'Elmstead', 'Fernhill', 'Greyfield', 'Hollins', 'Ironbridge', 'Juniper', 'Kelvingate', 'Larkspur', 'Millbrook', 'Norbury', 'Oakhurst', 'Pemberton', 'Redfern', 'Stillwater', 'Thornbury', 'Upland', 'Vantage', 'Westerly', 'Yarrow', 'Zephyr', 'Alder', 'Birchmoor', 'Cobalt', 'Driftwood', 'Foxley', 'Granite', 'Harbourside', 'Lowther', 'Pinecrest', 'Riverton', 'Saltmarsh', 'Tidewater']
const INDUSTRY: [string, string, [number, number]][] = [
  ['Logistics', 'road freight and warehousing', [8000, 90000]],
  ['Fabrication', 'steel fabrication for construction', [12000, 140000]],
  ['Textiles', 'technical textile manufacturing', [6000, 70000]],
  ['Analytics', 'data analytics consulting', [5000, 60000]],
  ['Foods', 'packaged food production', [7000, 85000]],
  ['Marine Services', 'vessel maintenance and supply', [10000, 160000]],
  ['Packaging', 'corrugated packaging supply', [5000, 55000]],
  ['Timber', 'timber import and milling', [9000, 120000]],
  ['Medical Devices', 'distribution of medical devices', [15000, 180000]],
  ['Agritech', 'precision agriculture software', [6000, 75000]],
  ['Engineering', 'industrial engineering services', [11000, 150000]],
  ['Electronics', 'electronic component distribution', [8000, 110000]],
  ['Property', 'commercial property management', [9000, 95000]],
  ['Software', 'business software development', [5000, 65000]],
]
const SUFFIX: Record<Jur, string[]> = { US: ['LLC', 'Inc', 'LLC'], UK: ['Ltd', 'Ltd', 'LLP'], EU: [], VG: ['Ltd', 'Holdings Ltd'] }
const EU_FORMS: Record<string, { suffix: string; bank: string; registry: string; reg: () => string; city: () => [string, string] }> = {
  DE: { suffix: 'GmbH', bank: 'rheinhafen', registry: 'Handelsregister', reg: () => `HRB ${int(100000, 199999)}`, city: () => pick([['Hamburg', `${pick(['Speicherstrasse', 'Ost-West-Strasse', 'Am Sandtorkai'])} ${int(2, 90)}, 2045${int(7, 9)} Hamburg`], ['Bremen', `${pick(['Hafenstrasse', 'Am Wall', 'Faulenstrasse'])} ${int(2, 90)}, 2819${int(5, 9)} Bremen`]]) },
  NL: { suffix: 'BV', bank: 'lindeveld', registry: 'KvK (Netherlands)', reg: () => String(int(60000000, 89999999)), city: () => pick([['Rotterdam', `${pick(['Wijnhaven', 'Coolsingel', 'Westblaak'])} ${int(2, 140)}, 3011 ${pick(['WK', 'AD', 'BH'])} Rotterdam`], ['Utrecht', `${pick(['Oudegracht', 'Catharijnesingel'])} ${int(2, 140)}, 3511 ${pick(['AP', 'GC'])} Utrecht`]]) },
  FR: { suffix: 'SAS', bank: 'stclair', registry: 'RCS (France)', reg: () => `${int(300, 899)} ${int(100, 999)} ${int(100, 999)}`, city: () => pick([['Lyon', `${int(2, 80)} rue ${pick(['des Tanneurs', 'Duguesclin', 'de la Charite'])}, 6900${int(2, 7)} Lyon`], ['Lille', `${int(2, 80)} rue ${pick(['Nationale', 'de Paris', 'Esquermoise'])}, 5900${int(0, 9)} Lille`]]) },
  IT: { suffix: 'Srl', bank: 'lagunare', registry: 'Registro Imprese', reg: () => `MI-${int(1000000, 2999999)}`, city: () => pick([['Milan', `Via ${pick(['Garibaldi', 'Solferino', 'Tortona'])} ${int(2, 90)}, 2012${int(1, 9)} Milano`], ['Turin', `Via ${pick(['Roma', 'Po', 'Nizza'])} ${int(2, 90)}, 1012${int(1, 9)} Torino`]]) },
}
const US_CITIES: [string, string, string, string][] = [['Houston', 'TX', '770', 'Texas Secretary of State'], ['Columbus', 'OH', '432', 'Ohio Secretary of State'], ['Denver', 'CO', '802', 'Colorado Secretary of State'], ['Charlotte', 'NC', '282', 'North Carolina Secretary of State'], ['Portland', 'OR', '972', 'Oregon Secretary of State'], ['Wilmington', 'DE', '198', 'Delaware Division of Corporations']]
const US_STREETS = ['Commerce Street', 'Lakeshore Drive', 'Industrial Parkway', 'Market Street', 'Elm Avenue', 'Riverside Boulevard', 'Foundry Road']
const UK_CITIES: [string, string][] = [['Manchester', 'M1'], ['Bristol', 'BS1'], ['Birmingham', 'B3'], ['Leeds', 'LS1'], ['Glasgow', 'G2'], ['London', 'EC1V'], ['Southampton', 'SO14']]
const UK_STREETS = ['Mill Lane', 'Station Road', 'Queen Street', 'Canal Side', 'Victoria Road', 'King Street', 'Wharf Road', 'Foundry Lane']
const L = 'ABDEFGHJLNPQRSTUWXYZ'

let addrSeq = 0
function newAddress(jur: Jur, kind: string, country?: string): string {
  const id = `addr-${String(++addrSeq).padStart(3, '0')}`
  if (jur === 'US') {
    const [city, st, zip] = pick(US_CITIES)
    const z = `${zip}${int(10, 99)}`
    address(id, `${int(100, 9800)} ${pick(US_STREETS)}${rand() < 0.5 ? `, Suite ${int(100, 900)}` : ''}, ${city}, ${st} ${z}`, 'US', { city, postcode: z, country: 'US', kind })
  } else if (jur === 'UK') {
    const [city, pre] = pick(UK_CITIES)
    const pc = `${pre} ${int(1, 9)}${pick([...L])}${pick([...L])}`
    address(id, `${rand() < 0.4 ? `Unit ${int(1, 30)}, ` : ''}${int(1, 220)} ${pick(UK_STREETS)}, ${city} ${pc}`, 'UK', { city, postcode: pc, country: 'GB', kind })
  } else if (jur === 'EU') {
    const [city, line] = EU_FORMS[country!].city()
    address(id, line, 'EU', { city, postcode: line.match(/\d{4,5}( [A-Z]{2})?/)![0], country: country!, kind })
  } else {
    throw new Error('VG companies use registered-agent addresses')
  }
  return id
}

// ordinary people
const usedNames = new Set(nodes.filter((n) => n.label === 'Person').map((n) => n.name))
const people: string[] = []
const peopleJur = new Map<string, Jur>()
for (let i = 0; people.length < 28; i++) {
  const name = `${pick(FIRST)} ${pick(LAST)}`
  if (usedNames.has(name)) continue
  usedNames.add(name)
  const jur = pick<Jur>(['US', 'US', 'UK', 'UK', 'UK', 'EU', 'EU'])
  const id = `per-${slug(name)}`
  person(id, name, jur, { dob: randDate('1955-01-01', '1994-12-31'), nationality: pick(NAT[jur]), occupation: pick(OCCUPATIONS) })
  people.push(id)
  peopleJur.set(id, jur)
}

// ordinary companies
interface Co { id: string; jur: Jur; country: string; industry: (typeof INDUSTRY)[number]; acc: string; directors: string[]; owners: [string, number][] }
const cos: Co[] = []
const usedCoNames = new Set<string>()
const personQueue = shuffle(people)
const nextPerson = (jur: Jur) => {
  if (personQueue.length) return personQueue.shift()!
  const local = people.filter((p) => peopleJur.get(p) === jur)
  return pick(local.length ? local : people)
}
const VG_AGENTS = ['addr-coral-bay', 'addr-harbourline']
const UK_FORMATION_AGENT = newAddress('UK', 'corporate services provider')
for (let i = 0; cos.length < 26; i++) {
  const jur = pick<Jur>(['US', 'US', 'US', 'UK', 'UK', 'UK', 'EU', 'EU', 'EU', 'VG'])
  const country = jur === 'EU' ? pick(Object.keys(EU_FORMS)) : jur === 'UK' ? 'GB' : jur
  const industry = pick(INDUSTRY)
  const prefix = pick(PREFIX)
  const base = `${prefix} ${industry[0]}`
  const suffix = jur === 'EU' ? EU_FORMS[country].suffix : pick(SUFFIX[jur])
  const name = `${base} ${suffix}`
  if (usedCoNames.has(prefix)) continue // one company per prefix keeps short names unambiguous
  usedCoNames.add(prefix)
  const id = `co-${slug(base)}`
  const incorporated = randDate('2004-01-01', '2023-12-31')
  let registry: string
  let regNo: string
  let usCity: (typeof US_CITIES)[number] | null = null
  if (jur === 'US') {
    usCity = pick(US_CITIES)
    registry = usCity[3]
    regNo = String(int(1000000, 9999999))
  } else if (jur === 'UK') {
    registry = 'Companies House'
    regNo = String(int(4000000, 15999999)).padStart(8, '0')
  } else if (jur === 'EU') {
    registry = EU_FORMS[country].registry
    regNo = EU_FORMS[country].reg()
  } else {
    registry = 'BVI Registry of Corporate Affairs'
    regNo = String(int(1500000, 2199999))
  }
  company(id, name, jur, { registry_no: regNo, registry, incorporated, status: 'active', industry: industry[1], ...(jur === 'EU' ? { country } : {}) }, [base])
  cos.push({ id, jur, country, industry, acc: '', directors: [], owners: [] })
}

// addresses, officers and owners
for (const [ci, c] of cos.entries()) {
  const addr = c.jur === 'VG' ? pick(VG_AGENTS) : c.jur === 'UK' && rand() < 0.25 ? UK_FORMATION_AGENT : newAddress(c.jur, 'registered office', c.country)
  const nDir = rand() < 0.45 ? 2 : 1
  for (let k = 0; k < nDir; k++) {
    const p = nextPerson(c.jur)
    if (!c.directors.includes(p)) c.directors.push(p)
  }
  // ownership: a group parent among earlier companies, or 1–3 individual shareholders
  const parents = cos.slice(0, ci).filter((p) => p.jur !== c.jur || rand() < 0.5)
  if (parents.length && rand() < 0.3) {
    const parent = pick(parents)
    const pct = pick([100, 100, 75, 60])
    c.owners.push([parent.id, pct])
    if (pct < 100) c.owners.push([c.directors[0], 100 - pct])
  } else {
    const holders = [...c.directors]
    if (rand() < 0.4) holders.push(nextPerson(c.jur))
    const uniq = [...new Set(holders)]
    const splits = uniq.length === 1 ? [pick([100, 100, 80])] : uniq.length === 2 ? pick([[50, 50], [60, 40], [70, 30], [51, 49]]) : pick([[40, 35, 25], [50, 30, 20], [34, 33, 33]])
    uniq.forEach((h, k) => c.owners.push([h, splits[k]]))
  }
  const n = byId.get(c.id)!
  const [title, label] =
    c.jur === 'US' ? [`${n.props.registry} filing: ${n.name} (${n.props.registry_no})`, 'Certificate of formation']
      : c.jur === 'UK' ? [`Companies House filing: ${n.name} (${n.props.registry_no})`, 'Incorporation and registered office']
        : c.jur === 'VG' ? [`BVI registry search: ${n.name} (${n.props.registry_no})`, 'Search result']
          : [`${n.props.registry} extract: ${n.name} (${n.props.registry_no})`, 'Registration']
  const sec = doc(`doc-reg-${c.id.replace(/^co-/, '')}`, 'registry', title, randDate('2024-06-01', '2026-06-30'))
  const placeOf: Record<Jur, string> = { US: `the state register (${n.props.registry})`, UK: 'England and Wales', EU: `the ${n.props.registry}`, VG: 'the British Virgin Islands' }
  const s1 = sec(label, pick([
    `${n.name} was incorporated in ${placeOf[c.jur]} on ${longDate(String(n.props.incorporated))} under number ${n.props.registry_no}. Its registered office is ${nameOf(addr)}. The stated business is ${c.industry[1]}.`,
    `The register shows ${n.name}, number ${n.props.registry_no}, as active since ${longDate(String(n.props.incorporated))}. The registered address on file is ${nameOf(addr)}. Its principal activity is ${c.industry[1]}.`,
  ]))
  rel('INCORPORATED_IN', c.id, JUR_ID[c.jur], s1, conf(0.97, 0.99))
  rel('REGISTERED_AT', c.id, addr, s1, conf(0.95, 0.99), { kind: c.jur === 'VG' ? 'registered agent' : 'registered office' })
  const dirText = c.directors.map((d) => nameOf(d)).join(' and ')
  const ownText = c.owners.map(([o, p]) => `${nameOf(o)} holds ${p} percent`).join(', and ')
  const s2 = sec('Officers and shareholders', `${c.directors.length > 1 ? 'The directors are' : 'The sole director is'} ${dirText}. ${ownText.charAt(0).toUpperCase() + ownText.slice(1)} of the issued shares. ${pick(['The latest confirmation statement was filed on time.', 'No charges are registered against the company.', 'The filing history shows no late returns.'])}`)
  for (const d of c.directors) rel('DIRECTOR_OF', d, c.id, s2, conf(0.94, 0.99), { role: 'director', appointed: randDate(String(n.props.incorporated), '2025-12-31') })
  for (const [o, p] of c.owners) rel('OWNS', o, c.id, s2, conf(0.93, 0.98), { pct: p })
}

// company accounts
const BANK_FOR: Record<Jur, string[]> = { US: ['harbor', 'prairie'], UK: ['thamesgate', 'kingsmere'], EU: [], VG: ['tortola'] }
for (const c of cos) {
  const bankKey = c.jur === 'EU' ? EU_FORMS[c.country].bank : pick(BANK_FOR[c.jur])
  const n = byId.get(c.id)!
  const opened = addDays(String(n.props.incorporated), int(20, 200))
  c.acc = `acc-${c.id.replace(/^co-/, '')}`
  const acc = account(c.acc, bankKey, c.id, opened, c.jur === 'US' ? 'business checking' : 'business current')
  const b = BANKS[bankKey]
  const turnover = Math.round((c.industry[2][1] * int(3, 8)) / 1000) * 1000
  kycFile(acc, opened, `${n.name} opened a business account with ${b.name} on ${longDate(opened)}, ${b.country === 'US' ? `account number ${byId.get(c.acc)!.props.account_number}` : `IBAN ${byId.get(c.acc)!.name}`}. The stated purpose is ${c.industry[1]} with expected turnover of about ${money(turnover, b.currency)} a month. Beneficial ownership was verified against ${c.jur === 'VG' ? 'the registered agent\'s records' : 'the public register'}.`, pick(['Activity is consistent with the declared business profile.', 'No unusual activity was identified in the review period.', 'Counterparties are established trade customers and suppliers.']), randDate('2025-01-01', '2026-06-30'))
}

// a few personal accounts with devices for ordinary people
const personalHolders = shuffle(people.filter((p) => peopleJur.get(p) !== 'EU')).slice(0, 8)
const devices: string[] = []
for (let i = 0; i < personalHolders.length - 1; i++) {
  const id = `dev-${String(i + 1).padStart(3, '0')}`
  const fp = digits(4) + 'a' + digits(3)
  add(id, 'Device', `${pick(['iPhone', 'Android handset', 'Windows laptop', 'MacBook'])} (fingerprint ${fp})`, { type: pick(['mobile', 'desktop']), fingerprint: fp, first_seen: randDate('2023-01-01', '2025-12-31') }, { aliases: [fp] })
  devices.push(id)
}
let nextOwnDevice = 0 // device 0 is the household's shared laptop; everyone else has their own
const householdAddr = newAddress('UK', 'residential')
const householders = personalHolders.filter((p) => peopleJur.get(p) === 'UK').slice(0, 2)
if (householders.length < 2) throw new Error('need two UK personal holders for the household')
for (const p of personalHolders) {
  const jur = peopleJur.get(p)!
  const bankKey = pick(BANK_FOR[jur])
  const opened = randDate('2015-01-01', '2025-06-30')
  const accId = `acc-${p.replace(/^per-/, '')}`
  const acc = account(accId, bankKey, p, opened, jur === 'US' ? 'personal checking' : 'personal current')
  // two UK holders form a household sharing an address and a laptop: a benign shared attribute
  const household = householders.includes(p)
  const addr = household ? householdAddr : newAddress(jur, 'residential')
  const dev = household ? devices[0] : devices[1 + nextOwnDevice++]
  const sec = kycFile(acc, opened, `${nameOf(p)} opened a personal account with ${BANKS[bankKey].name} on ${longDate(opened)}. The verified residential address is ${nameOf(addr)}. Income is from employment as ${String(byId.get(p)!.props.occupation).toLowerCase()}.`, 'Spending and income are in line with the customer profile.', randDate('2025-01-01', '2026-06-30'))
  rel('REGISTERED_AT', p, addr, kycByAccount.get(accId)!.docId + '-s1', conf(0.9, 0.96), { kind: 'residential' })
  const s2 = sec('Digital footprint', `Online banking sessions use the device with fingerprint ${byId.get(dev)!.props.fingerprint}. ${household ? 'The device is shared with another customer at the same address, consistent with a household.' : 'No other customers are linked to this device.'}`)
  rel('USED_DEVICE', accId, dev, s2, conf(0.9, 0.97), { first_seen: opened, sessions: int(20, 300) })
}

// ordinary trade payments between company accounts, plus a few into scenario companies
const payment = (from: string, to: string, amount: number, date: string, purpose: string, id?: string) => {
  const fb = BANKS[accounts.get(from)!.bank]
  const tb = BANKS[accounts.get(to)!.bank]
  let d = date
  const ch = channelFor(fb, tb)
  if (ch === 'wire' && d === '2026-03-14') d = '2026-03-16' // keep "the 14 March wire" unambiguous
  return txn(id ?? `txn-${String(txnSeq + 1).padStart(3, '0')}`, from, to, amount, fb.currency, d, ch, `${pick(['INV', 'PO', 'SO'])}-${int(10000, 99999)}`, purpose)
}
for (let k = 0; k < 28; k++) {
  const from = pick(cos)
  let to = pick(cos)
  while (to === from) to = pick(cos)
  const [lo, hi] = to.industry[2]
  payment(from.acc, to.acc, Math.round(int(lo, hi) / 10) * 10, randDate('2025-10-01', '2026-09-30'), `Payment for ${to.industry[1]}`)
}
// customers paying Meridian and Kestrel Bay (their legitimate-looking side)
for (const [i, c] of cos.filter((c) => c.jur === 'US').slice(0, 3).entries()) payment(c.acc, 'acc-meridian-us', int(41, 96) * 1000 + int(0, 9) * 50, `2026-0${i + 2}-${10 + i * 4}`, 'Purchase of marine fittings')
for (const c of cos.filter((c) => c.jur === 'UK').slice(0, 2)) payment(c.acc, S.FRONT_ACCOUNT, int(18, 42) * 1000, randDate('2026-01-05', '2026-03-01'), 'Purchase of fertiliser')
const euCo = cos.filter((c) => c.jur === 'EU')
payment(euCo[0].acc, 'acc-volgamar-seafoods-de', 48250, '2026-04-08', 'Frozen cod order')
payment('acc-volgamar-seafoods-de', euCo[1 % euCo.length].acc, 21900, '2026-05-19', 'Cold-chain logistics')
payment(euCo[2 % euCo.length].acc, 'acc-northgate-us', 412000, '2026-06-11', 'Wellhead equipment overhaul', 'txn-northgate-0611')
// personal accounts: salaries/dividends from the companies they direct
for (const p of personalHolders) {
  const accId = `acc-${p.replace(/^per-/, '')}`
  const c = cos.find((x) => x.directors.includes(p) && BANKS[accounts.get(x.acc)!.bank].currency === accounts.get(accId)!.currency)
  if (c) payment(c.acc, accId, int(35, 140) * 100, randDate('2025-11-01', '2026-08-31'), 'Director remuneration')
}

// ordinary EDD case on an offshore company
const vgCo = cos.find((c) => c.jur === 'VG') ?? cos[0]
add('case-2026-0251', 'Case', `CASE-2026-0251 Periodic EDD review: ${nameOf(vgCo.id)}`, { status: 'closed', opened: '2026-07-02', closed: '2026-07-24', priority: 'medium', analyst: 'Tomas Lindqvist', typology: 'Periodic enhanced due diligence' }, { jurisdiction: vgCo.jur, aliases: ['CASE-2026-0251'] })
{
  const sec = doc('doc-case-2026-0251', 'case-note', `Case note CASE-2026-0251: periodic EDD review of ${nameOf(vgCo.id)}`, '2026-07-24')
  const s1 = sec('Review outcome', `${nameOf(vgCo.id)} is subject to enhanced due diligence because it is incorporated offshore. The review confirmed the shareholders as ${vgCo.owners.map(([o]) => nameOf(o)).join(' and ')} and found the account activity consistent with ${vgCo.industry[1]}. The case was closed with no further action.`)
  rel('SUBJECT_OF', vgCo.id, 'case-2026-0251', s1, 0.95, { role: 'primary subject' })
}

// an ordinary alert on a cross-border trade payment, closed after the customer supplied invoices
{
  const hit = cos
    .flatMap((c) => accounts.get(c.acc)!.txns.filter((x) => x.dir === 'out'))
    .map((x) => byId.get(x.txn)!)
    .find((t) => t.props.channel === 'wire' && t.id !== 'txn-northgate-0611' && String(t.props.date) >= '2026-01-01')
  if (!hit) throw new Error('no ordinary wire to alert on')
  const date = String(hit.props.date)
  const code = `ALT-${date.slice(0, 4)}-${date.slice(5, 7)}${date.slice(8, 10)}-03`
  const id = code.toLowerCase().replace('alt', 'alert')
  const sec = doc(`doc-${id}`, 'case-note', `Alert disposition ${code}: unusual cross-border amount`, addDays(date, 2))
  const s = sec('Disposition', `Alert ${code} fired on the ${longDate(date)} wire of ${money(Number(hit.props.amount), String(hit.props.currency))} because it crossed a border and was more than three times the customer's 90-day average payment. The originator provided a matching purchase order and invoice. The alert was closed with no further action.`)
  add(id, 'Alert', `${code} Unusual cross-border amount`, { rule: 'CROSS_BORDER_SPIKE', reason: 'Cross-border payment more than 3x the 90-day average; supported by purchase order and invoice.', threshold: 3, date, status: 'closed-no-action', score: 41 }, { jurisdiction: hit.jurisdiction, aliases: [code] })
  rel('FLAGS', id, hit.id, s, 0.97)
}

// ---------------------------------------------------------------- activity sections (SENT/RECEIVED provenance)
const counterpartyOf = (txnId: string, self: string, dir: 'in' | 'out') => {
  const other = [...accounts.values()].find((a) => a.id !== self && a.txns.some((x) => x.txn === txnId && x.dir !== dir))
  return other ? nameOf(other.holder) : null
}
const branchName = (ref: string) => ref.replace('BRANCH-', '').split('-').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ')
const activitySection = new Map<string, string>() // txn|dir|acc -> section
for (const acc of accounts.values()) {
  if (!acc.txns.length) continue
  const k = kycByAccount.get(acc.id)!
  const sorted = [...acc.txns].sort((a, b) => String(byId.get(a.txn)!.props.date).localeCompare(String(byId.get(b.txn)!.props.date)))
  for (let start = 0; start < sorted.length; start += 6) {
    const chunk = sorted.slice(start, start + 6)
    const first = String(byId.get(chunk[0].txn)!.props.date)
    const last = String(byId.get(chunk[chunk.length - 1].txn)!.props.date)
    const items = chunk.map(({ txn: t, dir }) => {
      const n = byId.get(t)!
      const amt = money(Number(n.props.amount), String(n.props.currency))
      const cp = counterpartyOf(t, acc.id, dir)
      const what = n.props.channel === 'cash' ? `a cash deposit of ${amt} at the ${branchName(String(n.props.reference))} branch` : `${dir === 'out' ? 'an outgoing' : 'an incoming'} ${CHANNEL_TEXT[String(n.props.channel)]} of ${amt} ${dir === 'out' ? 'to' : 'from'} ${cp}`
      return `${what} on ${longDate(String(n.props.date))} (ref ${n.props.reference})`
    })
    const title = sorted.length > 6 ? `Account activity review (part ${start / 6 + 1})` : 'Account activity review'
    const sid = k.sec(title, `This review of ${nameOf(acc.id)} held by ${nameOf(acc.holder)} covers ${chunk.length > 1 ? `${chunk.length} transactions from ${longDate(first)} to ${longDate(last)}` : `1 transaction on ${longDate(first)}`}. Items noted: ${items.join('; ')}. ${k.note}`)
    for (const { txn: t, dir } of chunk) activitySection.set(`${t}|${dir}|${acc.id}`, sid)
  }
}
for (const acc of accounts.values()) {
  for (const { txn: t, dir } of acc.txns) {
    rel(dir === 'out' ? 'SENT' : 'RECEIVED', acc.id, t, activitySection.get(`${t}|${dir}|${acc.id}`)!, 0.99, dir === 'out' ? { role: 'originator' } : { role: 'beneficiary' })
  }
}

// alerts whose transactions are created late
for (const [alertId, txnId, sid] of pendingFlags) rel('FLAGS', alertId, txnId, sid, 0.97)

// ---------------------------------------------------------------- write
const world: World = { nodes, rels, documents, sections }
const out = fileURLToPath(new URL('../src/data/world.json', import.meta.url))
writeFileSync(out, JSON.stringify(world) + '\n')
const count = (xs: { label?: string; type?: string }[], key: 'label' | 'type') => xs.reduce<Record<string, number>>((m, x) => ((m[x[key]!] = (m[x[key]!] ?? 0) + 1), m), {})
console.log(`wrote ${out}`)
console.log('nodes', nodes.length, count(nodes, 'label'))
console.log('rels', rels.length, count(rels, 'type'))
console.log('documents', documents.length, 'sections', sections.length)
