import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react'
import type { Fact } from '../../domain/types'

type Sort = 'none' | 'desc' | 'asc'
const NEXT: Record<Sort, Sort> = { none: 'desc', desc: 'asc', asc: 'none' }

export function FactsTable({ facts }: { facts: Fact[] }) {
  const [q, setQ] = useState('')
  const [usedOnly, setUsedOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('none')

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = facts.filter(
      (f) =>
        (!usedOnly || f.used) &&
        (!needle || `${f.subject} ${f.relation} ${f.relation.replace(/_/g, ' ')} ${f.object}`.toLowerCase().includes(needle)),
    )
    if (sort === 'none') return list
    return [...list].sort((a, b) => (sort === 'desc' ? b.confidence - a.confidence : a.confidence - b.confidence))
  }, [facts, q, usedOnly, sort])

  if (facts.length === 0) return <p className="ev-empty">No facts for this answer.</p>

  const SortIcon = sort === 'desc' ? ArrowDown : sort === 'asc' ? ArrowUp : ChevronsUpDown
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
      </div>
      {rows.length === 0 ? (
        <p className="ev-empty">No facts match.</p>
      ) : (
        <table className="facts__table">
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col">Relation</th>
              <th scope="col">Object</th>
              <th scope="col" aria-sort={sort === 'none' ? 'none' : sort === 'desc' ? 'descending' : 'ascending'} className="facts__num">
                <button type="button" className="facts__sort" aria-label="Sort by confidence" onClick={() => setSort(NEXT[sort])}>
                  Conf. <SortIcon size={12} aria-hidden />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.rel_id} className={f.used ? 'is-used' : undefined}>
                <td>{f.subject}</td>
                <td className="facts__rel">{f.relation.replace(/_/g, ' ').toLowerCase()}</td>
                <td>{f.object}</td>
                <td className="facts__num">{f.confidence.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
