import { describe, expect, it } from 'vitest'
import { istDate, istMonth, istParts } from './istDate'
import { dayRange } from './dailyReportEmail'
import { vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/email', () => ({ sendEmailAs: async () => undefined }))

describe('IST boundaries', () => {
  it('reads the IST calendar day, not the UTC one', () => {
    expect(istParts(new Date('2026-03-31T20:00:00Z'))).toMatchObject({ y: 2026, m: 3, d: 1 }) // 01:30 IST Apr 1
  })
  it('puts IST midnight at 18:30 UTC the day before', () => {
    expect(istDate(2026, 3, 1).toISOString()).toBe('2026-03-31T18:30:00.000Z')
  })
  it('counts a deal at 03:00 IST on the 1st in the new month', () => {
    const won = new Date('2026-03-31T21:30:00Z')
    const { start, end } = istMonth(won)
    expect(won >= start && won <= end).toBe(true)
    expect(start.toISOString()).toBe('2026-03-31T18:30:00.000Z')
  })
  it('daily report day covers IST midnight to midnight', () => {
    const { start, end } = dayRange(new Date('2026-11-23T20:00:00Z')) // 01:30 IST Nov 24
    expect(start.toISOString()).toBe('2026-11-23T18:30:00.000Z')
    expect(end.toISOString()).toBe('2026-11-24T18:29:59.999Z')
  })
})
