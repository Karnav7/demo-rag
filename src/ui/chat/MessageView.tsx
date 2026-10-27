import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { Message } from '../../store/store'
import { useAppStore } from '../../store/StoreProvider'
import { DUR, EASE, useReducedMotion } from '../theme/motion'
import { Markdown } from './Markdown'
import { modeLabel, SOURCE_LABEL } from './labels'

const COPIED_MS = 1400

function Meter({ value, grow }: { value: number; grow: boolean }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div
      className="meter"
      role="meter"
      aria-label="Grounding confidence"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={v}
      aria-valuetext={v.toFixed(2)}
    >
      <span className="meter__track" aria-hidden>
        <motion.span
          className="meter__fill"
          initial={grow ? { scaleX: 0 } : false}
          animate={{ scaleX: v }}
          transition={{ duration: DUR.slow, ease: EASE, delay: 0.1 }}
        />
      </span>
      <span className="meter__label" aria-hidden>
        Grounding confidence <b>{v.toFixed(2)}</b>
      </span>
    </div>
  )
}

function StageLine({ text }: { text: string }) {
  return (
    <p className="stage" role="status">
      <span className="stage__dot" aria-hidden />
      <span className="stage__text">{text}</span>
    </p>
  )
}

function UserMessage({ m, fresh }: { m: Message; fresh: boolean }) {
  return (
    <motion.article
      className="msg msg--user"
      aria-label="Your question"
      initial={fresh ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.slow, ease: EASE }}
    >
      <p>{m.text}</p>
    </motion.article>
  )
}

function AssistantMessage({ m, fresh }: { m: Message; fresh: boolean }) {
  const { settings, selectedMessageId, selectMessage, setHighlight, regenerate, vote, send } = useAppStore()
  const reduced = useReducedMotion()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  // Animate the late parts (chips, meter) only for answers that arrived while this view was mounted.
  const streamed = useRef(!!m.pending)
  if (m.pending) streamed.current = true
  const animateLate = streamed.current && !reduced

  const r = m.response
  const selected = selectedMessageId === m.id
  const stage = `${modeLabel(settings.mode)} retrieval · ${settings.source === 'live' ? 'querying Neo4j…' : 'reading snapshot…'}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r?.answer ?? m.text)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      /* clipboard unavailable: nothing to confirm */
    }
  }

  const onCite = (n: number) => {
    const c = r?.citations.find((x) => x.n === n)
    selectMessage(m.id)
    if (c) setHighlight({ messageId: m.id, sectionId: c.section_id })
  }

  return (
    // Clicking anywhere on the turn shows its evidence; keyboard users get there via its citations and actions.
    <motion.article
      className={`msg msg--asst${selected ? ' msg--selected' : ''}`}
      aria-label="Answer"
      aria-current={selected || undefined}
      aria-busy={m.pending || undefined}
      onClick={() => selectMessage(m.id)}
      initial={fresh ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.slow, ease: EASE }}
    >
      {m.pending && !m.text ? (
        <StageLine text={stage} />
      ) : (
        <div className={m.pending ? 'msg__body msg__body--streaming' : 'msg__body'}>
          <Markdown text={m.text} citations={m.pending ? undefined : (r?.citations ?? [])} onCite={onCite} />
        </div>
      )}

      {r && !m.pending && (
        <>
          {r.resolvedQuestion && <p className="msg__resolved">· resolved: “{r.resolvedQuestion}”</p>}
          <div className="msg__meta">
            <Meter value={r.confidence} grow={animateLate} />
            <span className="msg__stats">
              {modeLabel(r.stats.settings.mode)} · {SOURCE_LABEL[r.stats.settings.source]} · {r.stats.totalMs} ms
            </span>
          </div>
          {r.followUps.length > 0 && (
            <motion.div
              className="chips"
              role="group"
              aria-label="Suggested follow-ups"
              initial={animateLate ? { opacity: 0, y: 4 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.base, ease: EASE, delay: 0.25 }}
            >
              {r.followUps.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chip"
                  onClick={(e) => {
                    e.stopPropagation()
                    void send(q)
                  }}
                >
                  {q}
                </button>
              ))}
            </motion.div>
          )}
        </>
      )}

      {!m.pending && (
        <div className="msg__actions">
          <button type="button" className="act" aria-label="Copy answer" title="Copy answer" onClick={copy}>
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          </button>
          <button type="button" className="act" aria-label="Regenerate" title="Regenerate" onClick={() => void regenerate(m.id)}>
            <RotateCcw size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="act"
            aria-label="Good answer"
            title="Good answer"
            aria-pressed={m.vote === 'up'}
            onClick={() => vote(m.id, m.vote === 'up' ? null : 'up')}
          >
            <ThumbsUp size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="act"
            aria-label="Poor answer"
            title="Poor answer"
            aria-pressed={m.vote === 'down'}
            onClick={() => vote(m.id, m.vote === 'down' ? null : 'down')}
          >
            <ThumbsDown size={14} aria-hidden />
          </button>
          <span className="msg__copied" role="status">
            {copied ? 'Copied' : ''}
          </span>
        </div>
      )}
    </motion.article>
  )
}

export function MessageView({ message, fresh }: { message: Message; fresh: boolean }) {
  return message.role === 'user' ? <UserMessage m={message} fresh={fresh} /> : <AssistantMessage m={message} fresh={fresh} />
}
