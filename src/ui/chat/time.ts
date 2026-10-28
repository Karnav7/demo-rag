/** Message times, Teams-style: a short clock time on each turn, a day label between days. Local calendar days. */

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' })
const MONTH_DAY_YEAR = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' })

const DAY_MS = 86_400_000
const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

/** "8:31 AM" (or the locale's equivalent). */
export const clockTime = (ms: number) => CLOCK.format(ms)

/** "Wednesday, October 28, 2026 at 8:31 AM": the hover title for a time. */
export const fullTime = (ms: number) => FULL.format(ms)

export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b)

/** Today, Yesterday, a weekday within the last week, else "October 21" (with the year when it is not this year). */
export function dayLabel(ms: number, now: number = Date.now()): string {
  // Round: a DST change makes a calendar day 23 or 25 hours long.
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return WEEKDAY.format(ms)
  return new Date(ms).getFullYear() === new Date(now).getFullYear() ? MONTH_DAY.format(ms) : MONTH_DAY_YEAR.format(ms)
}
