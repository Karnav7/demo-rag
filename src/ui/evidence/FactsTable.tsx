import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react'
import { confToken } from '../theme/scale'
import type { Fact } from '../../domain/types'

type Key = 'subject' | 'relation' | 'object' | 'confidence'
type Dir = 'asc' | 'desc'
type Sort = { key: Key; dir: Dir } | null

const COLS: { key: Key; label: string; name: string }[] = [
  { key: 'subject', label: 'Subject', name: 'subject' },
  { key: 'relation', label: 'Relation', name: 'relation' },
  { key: 'object', label: 'Object', name: 'object' },
  { key: 'confidence', label: 'Conf.', name: 'confidence' },
]
/** Confidence starts high-first, text columns A to Z; a third click on the same column restores retrieval order. */
const FIRST: Record<Key, Dir> = { subject: 'asc', relation: 'asc', object: 'asc', confidence: 'desc' }

function nextSort(cur: Sort, key: Key): Sort {
  if (!cur || cur.key !== key) return { key, dir: FIRST[key] }
  if (cur.dir === FIRST[key]) return { key, dir: FIRST[key] === 'asc' ? 'desc' : 'asc' }
  return null
}

const relText = (r: string) => r.replace(/_/g, ' ').toLowerCase()
function compare(a: Fact, b: Fact, key: Key): number {
  if (key === 'confidence') return a.confidence - b.confidence
  const va = key === 'relation' ? relText(a.relation) : a[key]
  const vb = key === 'relation' ? relText(b.relation) : b[key]
  return va.localeCompare(vb)
}

export function FactsTable({ facts }: { facts: Fact[] }) {
  const [q, setQ] = useState('')
  const [usedOnly, setUsedOnly] = useState(false)
  const [sort, setSort] = useState<Sort>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = facts.filter(
      (f) =>
        (!usedOnly || f.used) &&
        (!needle || `${f.subject} ${f.relation} ${f.relation.replace(/_/g, ' ')} ${f.object}`.toLowerCase().includes(needle)),
    )
    if (!sort) return list
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => sign * compare(a, b, sort.key))
  }, [facts, q, usedOnly, sort])

  if (facts.length === 0) return <p className="ev-empty">No facts for this answer.</p>

  return (
    <div className="facts">
      <div className="facts__bar">
        <label className="facts__search">
          <Search size={13} aria-hidden />
          <input type="search" placeholder="Filter facts" aria-label="Filter facts" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={usedOnly}
          aria-label="Only facts used in the answer"
          className="pill tog"
          onClick={() => setUsedOnly((v) => !v)}
        >
          <span className="tog__track" aria-hidden>
            <span className="tog__thumb" />
          </span>
          Used only
        </button>
        <span className="facts__count" aria-live="polite">
          {rows.length} of {facts.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="ev-empty">No facts match.</p>
      ) : (
        <table className="facts__table">
          <thead>
            <tr>
              {COLS.map((c) => {
                const on = sort?.key === c.key ? sort.dir : null
                const Icon = on === 'desc' ? ArrowDown : on === 'asc' ? ArrowUp : ChevronsUpDown
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={on === 'desc' ? 'descending' : on === 'asc' ? 'ascending' : 'none'}
                    className={c.key === 'confidence' ? 'facts__num' : undefined}
                  >
                    <button
                      type="button"
                      className={`facts__sort${on ? ' is-on' : ''}`}
                      aria-label={`Sort by ${c.name}`}
                      onClick={() => setSort((cur) => nextSort(cur, c.key))}
                    >
                      {c.label} <Icon size={12} aria-hidden />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((f, i) => (
              <tr
                key={f.rel_id}
                className={`facts__row${f.used ? ' is-used' : ''}`}
                style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
              >
                <td>{f.subject}</td>
                <td className="facts__rel">{relText(f.relation)}</td>
                <td>{f.object}</td>
                <td className="facts__num">
                  <span className="facts__conf" style={{ '--c': confToken(f.confidence) } as React.CSSProperties}>
                    <span className="facts__dot" aria-hidden />
                    {f.confidence.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
