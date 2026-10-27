import { useMemo, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { BookOpen, Network, Plus, Search } from 'lucide-react'
import { useAppStore } from '../../store/StoreProvider'
import { ThemeToggle } from '../theme/ThemeToggle'
import { ConversationItem } from './ConversationItem'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const s = useAppStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const all = s.grouped()
    const q = query.trim()
    if (!q) return all
    const hits = new Set(s.search(q).map((c) => c.id))
    return all.map((g) => ({ ...g, items: g.items.filter((c) => hits.has(c.id)) })).filter((g) => g.items.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.conversations, query])

  const go = (to: string) => {
    navigate(to)
    onNavigate?.()
  }

  return (
    <aside className="sb" aria-label="Sidebar">
      <Link to="/" className="sb__brand" onClick={onNavigate}>
        <span className="sb__dot" aria-hidden />
        dummy-rag
      </Link>

      <button
        type="button"
        className="sb__new"
        onClick={() => {
          s.newConversation()
          go('/')
        }}
      >
        <Plus size={15} aria-hidden /> New conversation
      </button>

      <label className="sb__search">
        <Search size={14} aria-hidden />
        <input
          type="search"
          aria-label="Search conversations"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <nav className="sb__list" aria-label="Conversations">
        {groups.length === 0 && <p className="sb__empty">{query.trim() ? 'No matches' : 'No conversations yet'}</p>}
        {groups.map((g) => (
          <section key={g.label}>
            <h3 className="sb__group">{g.label}</h3>
            <ul>
              {g.items.map((c) => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  active={c.id === s.activeId}
                  onOpen={(id) => {
                    s.select(id)
                    go('/')
                  }}
                  onRename={s.rename}
                  onDelete={s.remove}
                />
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <footer className="sb__foot">
        <NavLink to="/guide" className="sb__link" onClick={onNavigate}>
          <BookOpen size={15} aria-hidden />
          <span>
            Guide<small>Every feature explained</small>
          </span>
        </NavLink>
        <NavLink to="/architecture" className="sb__link" onClick={onNavigate}>
          <Network size={15} aria-hidden />
          <span>Architecture</span>
        </NavLink>
        <div className="sb__theme">
          <span>Theme</span>
          <ThemeToggle />
        </div>
      </footer>
    </aside>
  )
}
