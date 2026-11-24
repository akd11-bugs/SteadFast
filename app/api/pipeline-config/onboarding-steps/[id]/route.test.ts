import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calls, results, resetHarness, session, asUser, params, prismaStub } from '@/test/routeHarness'

vi.mock('@/lib/db', () => ({ prisma: prismaStub }))
vi.mock('@/lib/session', async () => {
  const { NextResponse } = await import('next/server')
  const { session } = await import('@/test/routeHarness')
  return {
    isAdmin: (u: { role?: string }) => u?.role === 'admin',
    requireApiUser: async () => session.user ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  }
})
vi.mock('@/lib/http', () => ({ readJsonBody: async (r: Request) => r.json() }))
const { DELETE } = await import('./route')

beforeEach(() => {
  resetHarness()
  session.user = asUser({ role: 'admin', orgId: 'org-a', visibleOrgIds: ['org-a'] })
  results.set('onboardingStepDefinition.findFirst', { id: 's1', orgId: 'org-a', key: 'kyc', isCore: false })
})

describe('DELETE onboarding step', () => {
  it('409s while leads are on the step and deletes nothing', async () => {
    results.set('lead.count', 12)
    const res = await DELETE(new Request('http://x'), params('s1'))
    expect(res.status).toBe(409)
    expect(calls.find((c) => c.model === 'lead' && c.op === 'count')!.args.where).toEqual({ orgId: 'org-a', onboardingSubStage: 'kyc' })
    expect(calls.some((c) => c.op === 'delete')).toBe(false)
  })

  it('deletes an unused step', async () => {
    expect((await DELETE(new Request('http://x'), params('s1'))).status).toBe(200)
  })
})
