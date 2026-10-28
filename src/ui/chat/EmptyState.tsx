import { motion } from 'motion/react'
import { DUR, EASE, useReducedMotion } from '../theme/motion'
import { starterQuestions } from './suggestions'

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
        {starterQuestions().map((q) => (
          <button key={q} type="button" className="chip" onClick={() => onAsk(q)}>
            {q}
          </button>
        ))}
      </motion.div>
    </div>
  )
}
