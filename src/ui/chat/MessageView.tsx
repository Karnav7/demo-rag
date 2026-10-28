import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, PanelRight, RotateCcw, Square, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { Message } from '../../store/store'
import type { TraceStage } from '../../domain/types'
import { useAppStore } from '../../store/StoreProvider'
import { DUR, EASE, useCountUp, useReducedMotion } from '../theme/motion'
import { confToken } from '../theme/scale'
import { useEvidenceDrawer } from '../evidence/drawer'
import { Markdown } from './Markdown'
import { modeLabel, SOURCE_LABEL } from './labels'
import { AssistantAvatar, UserAvatar } from './Avatar'
import { clockTime, fullTime } from './time'

const COPIED_MS = 1400

function Meter({ value, grow }: { value: number; grow: boolean }) {
  const v = Math.max(0, Math.min(1, value))
  const shown = useCountUp(v, grow)
  return (
    <div
      className="meter"
      style={{ '--meter': confToken(v) } as React.CSSProperties}
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
        Grounding confidence <b>{shown.toFixed(2)}</b>
      </span>
    </div>
  )
}

/** How many finished stages stay visible as ticks; older ones fold into "+N". */
const STAGE_TICKS = 4

/**
 * Live retrieval progress for a pending answer: the stage just reached shimmers on the status line
 * (cross-fading as stages arrive), finished stages collapse into a quiet row of ticks.
 */
function StageProgress({ stages, thinking }: { stages: TraceStage[]; thinking: string }) {
  const reduced = useReducedMotion()
  const current = stages.at(-1)
  const done = stages.slice(0, -1)
  const shown = done.slice(-STAGE_TICKS)
  const folded = done.length - shown.length
  const text = current ? `${current.title}…` : thinking
  return (
    <div className="stage">
      <p className="stage__line" role="status">
        <span className="stage__dot" aria-hidden />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={text}
            className="stage__text"
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </p>
      {done.length > 0 && (
        <ul className="stage__done" aria-label="Finished stages">
          {folded > 0 && <li className="stage__more">+{folded}</li>}
          {shown.map((t, i) => (
            <motion.li
              key={`${t.id}-${done.length - shown.length + i}`}
              className="stage__tick"
              initial={reduced ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: DUR.fast, ease: EASE }}
            >
              <Check size={11} aria-hidden />
              {t.title.replace(/\s*\(.*\)$/, '')}
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Who said it and when, above each turn; hovering the time shows the full date. */
function TurnHead({ name, at }: { name?: string; at: number }) {
  return (
    <div className="turn__head">
      {name && <span className="turn__name">{name}</span>}
      <time className="turn__time" dateTime={new Date(at).toISOString()} title={fullTime(at)}>
        {clockTime(at)}
      </time>
    </div>
  )
}

function UserMessage({ m, fresh }: { m: Message; fresh: boolean }) {
  return (
    <motion.div
      className="turn turn--user"
      initial={fresh ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.slow, ease: EASE }}
    >
      <UserAvatar />
      <div className="turn__main">
        <TurnHead at={m.createdAt} />
        <article className="msg msg--user" aria-label="Your question">
          <p>{m.text}</p>
        </article>
      </div>
    </motion.div>
  )
}

/** Each citation's strongest supporting fact confidence (facts share the cited section). */
function citeConfidence(r: Message['response']): Map<number, number> | undefined {
  if (!r) return undefined
  const best = new Map<string, number>()
  for (const f of r.facts) if (f.section_id) best.set(f.section_id, Math.max(best.get(f.section_id) ?? 0, f.confidence))
  return new Map(r.citations.flatMap((c) => (best.has(c.section_id) ? [[c.n, best.get(c.section_id)!] as const] : [])))
}

function AssistantMessage({ m, fresh }: { m: Message; fresh: boolean }) {
  const { settings, selectedMessageId, selectMessage, setHighlight, regenerate, vote, send } = useAppStore()
  const reduced = useReducedMotion()
  const drawer = useEvidenceDrawer()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  // Animate the late parts (chips, meter) only for answers that arrived while this view was mounted.
  const streamed = useRef(!!m.pending)
  if (m.pending) streamed.current = true
  const animateLate = streamed.current && !reduced

  const r = m.response
  const citeConf = useMemo(() => citeConfidence(r), [r])
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
    drawer.show()
    if (c) setHighlight({ messageId: m.id, sectionId: c.section_id })
  }

  return (
    <motion.div
      className="turn turn--asst"
      initial={fresh ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.slow, ease: EASE }}
    >
      <AssistantAvatar busy={!!m.pending} />
      <div className="turn__main">
        <TurnHead name="demo-rag" at={m.completedAt ?? m.createdAt} />
        {/* Clicking anywhere on the answer shows its evidence; keyboard users get there via its citations and actions. */}
        <article
          className={`msg msg--asst${selected ? ' msg--selected' : ''}`}
          aria-label="Answer"
          aria-current={selected || undefined}
          aria-busy={m.pending || undefined}
          onClick={() => selectMessage(m.id)}
        >
          {m.pending && !m.text ? (
            <StageProgress stages={m.stages ?? []} thinking={stage} />
          ) : (
            <div className={m.pending ? 'msg__body msg__body--streaming' : 'msg__body'}>
              <Markdown
                text={m.text}
                citations={m.pending ? undefined : (r?.citations ?? [])}
                citeConfidence={citeConf}
                onCite={onCite}
              />
            </div>
          )}

          {m.stopped && !m.pending && (
            <p className="msg__stopped">
              <Square size={9} fill="currentColor" aria-hidden /> Stopped{m.text ? ' — this answer is incomplete' : ' before an answer arrived'}
            </p>
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
              <button
                type="button"
                className="act"
                aria-label="Show evidence"
                title="Show evidence"
                onClick={() => {
                  selectMessage(m.id)
                  drawer.show()
                }}
              >
                <PanelRight size={14} aria-hidden />
              </button>
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
        </article>
      </div>
    </motion.div>
  )
}

export function MessageView({ message, fresh }: { message: Message; fresh: boolean }) {
  return message.role === 'user' ? <UserMessage m={message} fresh={fresh} /> : <AssistantMessage m={message} fresh={fresh} />
}
