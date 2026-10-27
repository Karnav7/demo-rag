import type { ChatEvent, ChatRequest, Source } from '../domain/types'
import { SnapshotChatClient, LATENCY } from './snapshotClient'

/** Streaming chat seam; mirrors a future `POST /chat` event stream. */
export interface ChatClient {
  /** Yields stage, token, then done events. Abort ends the iterator silently (no error event). */
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>
}

const chatUrl = (): string | undefined => import.meta.env.VITE_CHAT_URL || undefined

/** True while no backend URL is configured, i.e. "Live" is served by the snapshot engine. */
export function isLiveSimulated(): boolean {
  return !chatUrl()
}

export function createClient(source: Source): ChatClient {
  if (source === 'live' && chatUrl()) throw new Error('HttpChatClient not implemented yet')
  return new SnapshotChatClient(LATENCY[source])
}
