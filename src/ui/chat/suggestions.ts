import { loadWorld, type WorldIndex } from '../../data/load'
import { ALERTED_TXN, FRONT_COMPANY_NAME, MERIDIAN_NAME, MULE_ACCOUNTS } from '../../data/scenarios'

/** "2026-03-14" -> "14 March" */
const dayMonth = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })

/** The empty state's starter questions, built from the seeded scenarios. */
export function starterQuestions(w: WorldIndex = loadWorld()): string[] {
  const wireDate = String(w.byId.get(ALERTED_TXN)?.props.date ?? '')
  const mule = w.byId.get(MULE_ACCOUNTS[0])?.name ?? MULE_ACCOUNTS[0]
  return [
    `Who ultimately owns ${MERIDIAN_NAME}?`,
    `Is the director of ${FRONT_COMPANY_NAME} on a sanctions list?`,
    `Why was the ${dayMonth(wireDate)} wire flagged?`,
    `Which accounts share a device with ${mule}?`,
  ]
}
