import { istMonth } from '@/lib/istDate'

// Dashboard drill-down filters for /leads?filter=<key>. Built per request
// from `now`: a module-level constant froze "this month" at server start.
export function buildFilters(now: Date): Record<string, { where: Record<string, unknown>; label: string }> {
  const { start: monthStart, end: monthEnd } = istMonth(now)
  return {
    'partners-onboarded': {
      where: { type: 'partner', wonAt: { gte: monthStart, lte: monthEnd } },
      label: 'Partners onboarded this month',
    },
    'merchants-onboarded': {
      where: { type: 'merchant', wonAt: { gte: monthStart, lte: monthEnd } },
      label: 'Merchants onboarded this month',
    },
    'expected-to-onboard': {
      where: { wonAt: null, expectedCloseDate: { gte: monthStart, lte: monthEnd } },
      label: 'Expected to onboard by month end',
    },
    'open-pipeline': {
      where: { stage: { notIn: ['onboarding', 'not_interested'] } },
      label: 'Open pipeline',
    },
    'won-this-month': {
      where: { wonAt: { gte: monthStart, lte: monthEnd } },
      label: 'Won this month',
    },
    won: {
      where: { stage: 'onboarding' },
      label: 'Won',
    },
    closed: {
      where: { stage: { in: ['onboarding', 'not_interested'] } },
      label: 'Closed (won or not interested)',
    },
  }
}
