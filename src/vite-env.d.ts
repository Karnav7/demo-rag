/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of a future POST /chat backend. Unset means the in-browser snapshot engine. */
  readonly VITE_CHAT_URL?: string
}
