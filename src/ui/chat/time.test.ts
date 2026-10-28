import { describe, expect, it } from 'vitest'
import { clockTime, dayLabel, fullTime, sameDay } from './time'

// Local times, so the tests hold in any time zone.
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 10, 28, 8, 31) // Wednesday

describe('message times', () => {
  it('labels today, yesterday and the rest of the last week by name', () => {
    expect(dayLabel(at(2026, 10, 28, 0, 1), NOW)).toBe('Today')
    expect(dayLabel(at(2026, 10, 27, 23, 59), NOW)).toBe('Yesterday')
    expect(dayLabel(at(2026, 10, 26), NOW)).toBe(new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(at(2026, 10, 26)))
    expect(dayLabel(at(2026, 10, 22), NOW)).toBe(new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(at(2026, 10, 22)))
  })

  it('older days show the date, with the year only when it differs', () => {
    const md = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' })
    expect(dayLabel(at(2026, 10, 21), NOW)).toBe(md.format(at(2026, 10, 21)))
    const label = dayLabel(at(2025, 12, 31), NOW)
    expect(label).toContain('2025')
  })

  it('sameDay splits at local midnight', () => {
    expect(sameDay(at(2026, 10, 28, 0, 0), at(2026, 10, 28, 23, 59))).toBe(true)
    expect(sameDay(at(2026, 10, 27, 23, 59), at(2026, 10, 28, 0, 0))).toBe(false)
  })

  it('formats a short clock time and a full hover title', () => {
    expect(clockTime(NOW)).toMatch(/31/)
    expect(fullTime(NOW)).toContain('2026')
    expect(fullTime(NOW)).toMatch(/31/)
  })
})
