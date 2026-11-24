import { formatDate } from '@/lib/utils'
import { istDate, istDayEnd, istParts } from '@/lib/istDate'

export type RangeKey = 'today' | 'week' | 'month'

export const RANGE_LABELS: Record<RangeKey, string> = { today: 'Today', week: 'This week', month: 'This month' }

export function parseRangeKey(value: string | undefined): RangeKey {
  return value === 'today' || value === 'month' ? value : 'week'
}

export function getRange(range: RangeKey): { start: Date; end: Date; label: string } {
  const { y, m, d, dow } = istParts()
  if (range === 'today') {
    const start = istDate(y, m, d)
    return { start, end: istDayEnd(y, m, d), label: formatDate(start) }
  }
  if (range === 'month') {
    const start = istDate(y, m, 1)
    const end = istDayEnd(y, m + 1, 0)
    return { start, end, label: `${formatDate(start)} – ${formatDate(end)}` }
  }
  // week: Monday-start calendar week containing today
  const monday = d + (dow === 0 ? -6 : 1 - dow)
  const start = istDate(y, m, monday)
  const end = istDayEnd(y, m, monday + 6)
  return { start, end, label: `${formatDate(start)} – ${formatDate(end)}` }
}

export interface TrendBucket {
  start: Date
  end: Date
  label: string
}

const IST = 'Asia/Kolkata'

// Trailing Monday-start weeks, oldest first, ending with the current
// (in-progress) week.
export function getWeeklyBuckets(count: number): TrendBucket[] {
  const { y, m, d, dow } = istParts()
  const monday = d + (dow === 0 ? -6 : 1 - dow)
  const buckets: TrendBucket[] = []
  for (let i = count - 1; i >= 0; i--) {
    const start = istDate(y, m, monday - i * 7)
    buckets.push({ start, end: istDayEnd(y, m, monday - i * 7 + 6), label: formatDate(start) })
  }
  return buckets
}

// Trailing calendar months, oldest first, ending with the current
// (in-progress) month.
export function getMonthlyBuckets(count: number): TrendBucket[] {
  const { y, m } = istParts()
  const buckets: TrendBucket[] = []
  for (let i = count - 1; i >= 0; i--) {
    const start = istDate(y, m - i, 1)
    buckets.push({ start, end: istDayEnd(y, m - i + 1, 0), label: start.toLocaleDateString('en-US', { month: 'short', timeZone: IST }) })
  }
  return buckets
}

// Trailing calendar days, oldest first, ending with today — independent of
// the page's own range picker, same convention as the weekly/monthly trend
// buckets above.
export function getDailyBuckets(count: number): TrendBucket[] {
  const { y, m, d } = istParts()
  const buckets: TrendBucket[] = []
  for (let i = count - 1; i >= 0; i--) {
    const start = istDate(y, m, d - i)
    buckets.push({
      start,
      end: istDayEnd(y, m, d - i),
      label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: IST }),
    })
  }
  return buckets
}
