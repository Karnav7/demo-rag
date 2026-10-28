import { useId } from 'react'

/** The reader's avatar: a quiet circle that simply says "You". */
export function UserAvatar() {
  return (
    <span className="avatar avatar--user" aria-hidden>
      You
    </span>
  )
}

/**
 * demo-rag's mark: an accent-gradient squircle holding three linked nodes (a small graph) and a spark.
 * While an answer is on its way a soft ring breathes around it.
 */
export function AssistantAvatar({ busy = false, size = 28 }: { busy?: boolean; size?: number }) {
  const gid = useId()
  return (
    <span className={`avatar avatar--asst${busy ? ' avatar--busy' : ''}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 28 28" width={size} height={size}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--avatar-a)" />
            <stop offset="1" stopColor="var(--avatar-b)" />
          </linearGradient>
        </defs>
        <rect width="28" height="28" rx="9" fill={`url(#${gid})`} />
        <g stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.92">
          <path d="M9 18.5 L14 9.5 L19 18.5 Z" fill="none" strokeLinejoin="round" />
        </g>
        <g fill="#fff">
          <circle cx="14" cy="9.5" r="2.4" />
          <circle cx="9" cy="18.5" r="2.4" />
          <circle cx="19" cy="18.5" r="2.4" />
          <path d="M21.5 5.2 l.55 1.25 1.25.55 -1.25.55 -.55 1.25 -.55-1.25 -1.25-.55 1.25-.55z" opacity="0.85" />
        </g>
      </svg>
    </span>
  )
}
