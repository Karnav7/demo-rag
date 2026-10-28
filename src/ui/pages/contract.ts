import typesSource from '../../domain/types.ts?raw'

/** Pull a top-level declaration out of types.ts verbatim, so the docs cannot drift from the real contract. */
function declaration(name: string): string {
  const start = typesSource.search(new RegExp(`^export (interface|type) ${name}\\b`, 'm'))
  if (start < 0) throw new Error(`types.ts has no ${name}`)
  const rest = typesSource.slice(start)
  // A declaration ends at the first blank line or the next `export`.
  const end = rest.slice(1).search(/\n\s*\n|\nexport /)
  return (end < 0 ? rest : rest.slice(0, end + 1)).replace(/^export /, '').trimEnd()
}

export const CHAT_REQUEST_SOURCE = declaration('ChatRequest')
export const CHAT_EVENT_SOURCE = declaration('ChatEvent')
export const CHAT_CONTRACT_SOURCE = `${CHAT_REQUEST_SOURCE}\n\n${CHAT_EVENT_SOURCE}`
