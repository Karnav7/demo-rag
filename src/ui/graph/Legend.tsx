import type { NodeLabel } from '../../domain/types'
import { cssColor, labelName } from './graphStyle'

/** One swatch per node label present, plus the seed / used key. */
export function Legend({ labels }: { labels: NodeLabel[] }) {
  return (
    <div className="g-legend">
      <ul className="g-legend__list" aria-label="Node types">
        {labels.map((l) => (
          <li key={l}>
            <span className="g-legend__sw" style={{ background: cssColor(l) }} aria-hidden />
            {labelName(l)}
          </li>
        ))}
      </ul>
      <p className="g-legend__key">
        <span className="g-legend__seed" aria-hidden />
        Seed
        <span className="g-legend__used" aria-hidden />
        Used in the answer
      </p>
    </div>
  )
}
