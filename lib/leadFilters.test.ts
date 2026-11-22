import { describe, expect, it } from 'vitest'
import { buildFilters } from '@/lib/leadFilters'

type Range = { gte: Date; lte: Date }
const wonRange = (now: Date) => (buildFilters(now)['won-this-month'].where as { wonAt: Range }).wonAt

describe('buildFilters', () => {
  it('"this month" follows the date it is given, not a frozen one', () => {
    const jan = wonRange(new Date(2026, 0, 31, 23, 0))
    const feb = wonRange(new Date(2026, 1, 1, 0, 30))
    expect(jan.gte).toEqual(new Date(2026, 0, 1))
    expect(jan.lte.getDate()).toBe(31)
    expect(feb.gte).toEqual(new Date(2026, 1, 1))
    expect(feb.lte.getMonth()).toBe(1)
    expect(feb.lte.getDate()).toBe(28)
  })

  it('handles a December to January year rollover', () => {
    const dec = wonRange(new Date(2026, 11, 15))
    expect(dec.lte).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999))
  })
})
