import { Component, Suspense, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'

/**
 * Catches a render error or a rejected lazy import below it and shows `fallback` in its place,
 * so one broken view never unmounts the rest of the app.
 */
export class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Fallback for a code-split chunk that failed to load (flaky network, or a stale tab after a redeploy). */
export function LoadFailed() {
  return (
    <div className="lazy-note" role="alert">
      <p>Couldn&rsquo;t load this view.</p>
      <button type="button" className="pill lazy-note__reload" onClick={() => window.location.reload()}>
        <RotateCw size={13} aria-hidden /> Reload
      </button>
    </div>
  )
}

/** A code-split view: a quiet placeholder while its chunk loads, and a calm note with Reload if it fails. */
export function LazyView({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Boundary fallback={<LoadFailed />}>
      <Suspense
        fallback={
          <p className="lazy-note lazy-note--loading" role="status">
            {label}
          </p>
        }
      >
        {children}
      </Suspense>
    </Boundary>
  )
}
