import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetHarness, session, asUser, prismaStub } from '@/test/routeHarness'

vi.mock('@/lib/db', () => ({ prisma: prismaStub }))
vi.mock('@/lib/session', async () => {
  const { NextResponse } = await import('next/server')
  const { session } = await import('@/test/routeHarness')
  return {
    requireApiUser: async () => session.user ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    leadScope: (u: { visibleOrgIds: string[] }) => ({ orgId: { in: u.visibleOrgIds } }),
  }
})
const runSkill = vi.fn()
vi.mock('@/lib/skills/runner', () => ({ runSkill: (a: unknown) => runSkill(a) }))

const { POST } = await import('./route')
const post = (body: unknown) => POST(new Request('http://x/api/skills/run', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  resetHarness()
  runSkill.mockReset()
})

describe('POST /api/skills/run', () => {
  it('rejects an over-long question before running anything', async () => {
    session.user = asUser({ orgId: 'org-q', visibleOrgIds: ['org-q'] })
    const res = await post({ skillId: 's', userQuestion: 'x'.repeat(2001) })
    expect(res.status).toBe(400)
    expect(runSkill).not.toHaveBeenCalled()
  })

  it('hides the raw runner error from the client', async () => {
    session.user = asUser({ orgId: 'org-e', visibleOrgIds: ['org-e'] })
    runSkill.mockResolvedValue({ ok: false, skillId: 's', error: 'ENOENT /srv/app/skills/s/SKILL.md' })
    const res = await post({ skillId: 's' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('/srv/app')
  })

  it('stops an org after 20 runs in an hour', async () => {
    session.user = asUser({ orgId: 'org-r', visibleOrgIds: ['org-r'] })
    runSkill.mockResolvedValue({ ok: true, skillId: 's', skillName: 'S', runnerType: 'llm', outputMarkdown: '' })
    for (let i = 0; i < 20; i++) expect((await post({ skillId: 's' })).status).toBe(200)
    expect((await post({ skillId: 's' })).status).toBe(429)
    expect(runSkill).toHaveBeenCalledTimes(20)
  })

  it('loads only 3 activities per lead', async () => {
    session.user = asUser({ orgId: 'org-a', visibleOrgIds: ['org-a'] })
    runSkill.mockResolvedValue({ ok: true, skillId: 's', skillName: 'S', runnerType: 'llm', outputMarkdown: '' })
    const spy = vi.spyOn(prismaStub.lead, 'findMany')
    await post({ skillId: 's' })
    expect((spy.mock.calls[0][0] as { include: { activities: { take: number } } }).include.activities.take).toBe(3)
  })
})
