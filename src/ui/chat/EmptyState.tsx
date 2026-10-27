import { motion } from 'motion/react'
import { loadWorld } from '../../data/load'
import { ALERTED_TXN, FRONT_COMPANY_NAME, MERIDIAN_NAME, MULE_ACCOUNTS } from '../../data/scenarios'
import { DUR, EASE, useReducedMotion } from '../theme/motion'

/** "2026-03-14" -> "14 March" */
const dayMonth = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })

function suggestions(): string[] {
  const w = loadWorld()
  const wireDate = String(w.byId.get(ALERTED_TXN)?.props.date ?? '')
  const mule = w.byId.get(MULE_ACCOUNTS[0])?.name ?? MULE_ACCOUNTS[0]
  return [
    `Who ultimately owns ${MERIDIAN_NAME}?`,
    `Is the director of ${FRONT_COMPANY_NAME} on a sanctions list?`,
    `Why was the ${dayMonth(wireDate)} wire flagged?`,
    `Which accounts share a device with ${mule}?`,
  ]
}

export function EmptyState({ onAsk }: { onAsk(q: string): void }) {
  const reduced = useReducedMotion()
  const rise = (delay: number) =>
    reduced
      ? { initial: false as const }
      : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: DUR.slow, ease: EASE, delay } }

  return (
    <div className="empty">
      <motion.h1 className="empty__title" {...rise(0)}>What do you want to trace?</motion.h1>
      <motion.p className="empty__sub" {...rise(0.06)}>
        dummy-rag answers only from the graph and cites every claim. Fictional data for demonstration. Not financial or
        legal advice.
      </motion.p>
      <motion.div className="chips chips--suggest" role="group" aria-label="Suggested questions" {...rise(0.25)}>
        {suggestions().map((q) => (
          <button key={q} type="button" className="chip" onClick={() => onAsk(q)}>
            {q}
          </button>
        ))}
      </motion.div>
    </div>
  )
}
