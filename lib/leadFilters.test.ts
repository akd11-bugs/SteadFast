import { describe, expect, it } from 'vitest'
import { buildFilters } from '@/lib/leadFilters'

type Range = { gte: Date; lte: Date }
const wonRange = (now: Date) => (buildFilters(now)['won-this-month'].where as { wonAt: Range }).wonAt
const iso = (s: string) => new Date(s)

// Months are India-time months, whatever the server clock's zone.
describe('buildFilters', () => {
  it('"this month" follows the date it is given, in IST', () => {
    // 03:00 IST on Feb 1 is still Jan 31 in UTC; it must count as February.
    const feb = wonRange(iso('2026-01-31T21:30:00Z'))
    expect(feb.gte).toEqual(iso('2026-01-31T18:30:00Z')) // Feb 1 00:00 IST
    expect(feb.lte).toEqual(iso('2026-02-28T18:29:59.999Z')) // Feb 28 23:59:59.999 IST
    const jan = wonRange(iso('2026-01-31T18:00:00Z')) // 23:30 IST Jan 31
    expect(jan.gte).toEqual(iso('2025-12-31T18:30:00Z'))
  })

  it('handles a December to January year rollover', () => {
    const dec = wonRange(iso('2026-12-15T06:00:00Z'))
    expect(dec.lte).toEqual(iso('2026-12-31T18:29:59.999Z'))
  })
})
