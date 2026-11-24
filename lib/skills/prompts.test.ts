import { describe, expect, it } from 'vitest'
import { buildSkillPrompt, PORTFOLIO_LEAD_CAP } from './prompts'
import type { Lead } from '@/lib/types'

const lead = (i: number) =>
  ({ id: `l${i}`, company: { name: `Co ${i}` }, stage: 'new', activities: [], _count: { activities: 42 } }) as unknown as Lead

describe('buildSkillPrompt portfolio', () => {
  it('sends at most the cap and tells Claude it is a sample', () => {
    const leads = Array.from({ length: PORTFOLIO_LEAD_CAP + 50 }, (_, i) => lead(i))
    const p = buildSkillPrompt({ skillText: 'S', skillId: 'x', scope: 'portfolio', leads })
    expect(p).toContain(`${PORTFOLIO_LEAD_CAP} most recently updated of ${PORTFOLIO_LEAD_CAP + 50}`)
    expect(p).toContain('"l0"')
    expect(p).not.toContain(`"l${PORTFOLIO_LEAD_CAP}"`)
    expect(p).toContain('"activitiesCount": 42')
  })

  it('adds no sample note for a small pipeline', () => {
    const p = buildSkillPrompt({ skillText: 'S', skillId: 'x', scope: 'portfolio', leads: [lead(1)] })
    expect(p).not.toContain('This is a sample')
  })
})
