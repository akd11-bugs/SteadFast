import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calls, results, resetHarness, session, asUser, prismaStub } from '@/test/routeHarness'

vi.mock('@/lib/db', () => ({ prisma: prismaStub }))
vi.mock('@/lib/session', async () => {
  const { NextResponse } = await import('next/server')
  const { session } = await import('@/test/routeHarness')
  return {
    isAdmin: (u: { role?: string }) => u?.role === 'admin',
    isOperations: (u: { role?: string }) => u?.role === 'operations',
    requireApiUser: async () => session.user ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  }
})
vi.mock('@/lib/http', () => ({ readJsonBody: async (r: Request) => r.json() }))
const applyStageChange = vi.fn()
vi.mock('@/lib/leadStage', () => ({ applyStageChange: (...a: unknown[]) => applyStageChange(...a) }))
vi.mock('@/lib/pipelineConfig', () => ({ getStageDefinitions: async () => [{ key: 'new' }, { key: 'proposal' }, { key: 'onboarding' }] }))

const { POST } = await import('./route')
const ORG = 'org-a'
const call = (body: unknown = { stage: 'proposal' }) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ jobRunId: 'j1', issueId: 'i1' }) })
const ISSUE = { id: 'i1', jobRunId: 'j1', orgId: ORG, kind: 'stage_unmapped', leadId: 'lead-1', resolvedAt: null }

beforeEach(() => {
  resetHarness()
  applyStageChange.mockReset()
  session.user = asUser({ role: 'admin', orgId: ORG, visibleOrgIds: [ORG] })
  results.set('jobRunIssue.findFirst', ISSUE)
  results.set('jobRunIssue.updateMany', { count: 1 })
})

describe('resolve sync issue', () => {
  it('leaves a lead alone that moved since the import (keeps a won deal)', async () => {
    results.set('lead.findFirst', { orgId: ORG, stage: 'onboarding', wonAt: new Date() })
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).stageUnchanged).toBe(true)
    expect(applyStageChange).not.toHaveBeenCalled()
  })

  it('applies the stage when the lead is still in new', async () => {
    results.set('lead.findFirst', { orgId: ORG, stage: 'new', wonAt: null })
    expect((await call()).status).toBe(200)
    expect(applyStageChange).toHaveBeenCalledTimes(1)
    const claim = calls.find((c) => c.model === 'jobRunIssue' && c.op === 'updateMany')!
    expect(claim.args.where).toEqual({ id: 'i1', resolvedAt: null })
  })

  it('a second click that loses the claim changes nothing', async () => {
    results.set('lead.findFirst', { orgId: ORG, stage: 'new', wonAt: null })
    results.set('jobRunIssue.updateMany', { count: 0 })
    expect((await call()).status).toBe(409)
    expect(applyStageChange).not.toHaveBeenCalled()
  })

  it('reopens the issue if the stage change fails', async () => {
    results.set('lead.findFirst', { orgId: ORG, stage: 'new', wonAt: null })
    applyStageChange.mockRejectedValue(new Error('db down'))
    await expect(call()).rejects.toThrow('db down')
    const reopen = calls.filter((c) => c.model === 'jobRunIssue' && c.op === 'updateMany')[1]
    expect(reopen.args.data).toMatchObject({ resolvedAt: null })
  })
})
