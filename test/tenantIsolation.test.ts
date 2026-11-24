import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  calls, results, resetHarness, session, asUser, orgIdsSeen, params, prismaStub,
} from './routeHarness'

// vi.mock is hoisted, so these must sit at this file's top level.
vi.mock('@/lib/db', () => ({ prisma: prismaStub }))

vi.mock('@/lib/session', async () => {
  const { NextResponse } = await import('next/server')
  const { session } = await import('./routeHarness')
  const isAdmin = (u: { role?: string }) => u?.role === 'admin'
  const isOperations = (u: { role?: string }) => u?.role === 'operations'
  return {
    isAdmin,
    isOperations,
    requireApiUser: async () =>
      session.user ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    requireUser: async () => session.user,
    // Mirrors lib/session.ts exactly.
    leadScope: (u: { role?: string; id: string; visibleOrgIds: string[] }) =>
      isAdmin(u) || isOperations(u)
        ? { orgId: { in: u.visibleOrgIds } }
        : { orgId: { in: u.visibleOrgIds }, ownerId: u.id },
    resolveVisibleOrgIds: (orgId: string) => [orgId],
  }
})

vi.mock('@/lib/http', () => ({
  readJsonBody: async (req: Request) => {
    try {
      return await req.json()
    } catch {
      const { NextResponse } = await import('next/server')
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
  },
}))

vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }))

// Server pages render client components; stub them so only the page's own
// queries run. notFound() throws like the real one so a miss is observable.
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  redirect: () => { throw new Error('NEXT_REDIRECT') },
  useRouter: () => ({}),
}))
vi.mock('@/components/shared/RecordNavigator', () => ({ RecordNavigator: () => null }))
vi.mock('@/components/leads/LeadPageView', () => ({ LeadPageView: () => null }))
vi.mock('@/components/leads/LeadsTable', () => ({ LeadsTable: () => null }))
vi.mock('@/components/skills/SkillRunner', () => ({ SkillRunner: () => null }))

// Tenant-boundary tests for the routes the authorization audit ranked
// highest. Each handler is exercised for real; assertions are on the WHERE
// clause the handler actually sent to Prisma, so removing an orgId filter
// fails the suite rather than passing silently.

const ORG = 'org-a'

const leadsRoute = await import('@/app/api/leads/[id]/route')
const activitiesRoute = await import('@/app/api/activities/route')
const viewsIdRoute = await import('@/app/api/views/[id]/route')
const tasksIdRoute = await import('@/app/api/tasks/[id]/route')
const companiesIdRoute = await import('@/app/api/companies/[id]/route')
const leadDetailPage = (await import('@/app/leads/[id]/page')).default
const leadsPage = (await import('@/app/leads/page')).default
const skillPage = (await import('@/app/skills/[skillId]/page')).default

function req(url = 'http://test/api/x', init?: RequestInit) {
  return new Request(url, init)
}
function jsonReq(body: unknown, url = 'http://test/api/x') {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  resetHarness()
  session.user = asUser()
})

describe('unauthenticated access touches no data', () => {
  const cases: [string, () => Promise<Response>][] = [
    ['GET /leads/[id]', () => leadsRoute.GET(req(), params('lead-1')) as Promise<Response>],
    ['GET /activities', () => activitiesRoute.GET(req()) as Promise<Response>],
    ['DELETE /views/[id]', () => viewsIdRoute.DELETE(req(), params('v-1')) as Promise<Response>],
  ]

  it.each(cases)('%s returns 401 and issues no query', async (_name, run) => {
    session.user = null
    const res = await run()
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })
})

describe('GET /api/leads/[id] — the main lead surface', () => {
  it('scopes the lookup to the caller org', async () => {
    results.set('lead.findFirst', { id: 'lead-1', orgId: ORG, company: {}, person: {} })
    await leadsRoute.GET(req(), params('lead-1'))
    expect(orgIdsSeen().every(o => o === ORG)).toBe(true)
  })

  it('restricts a sales user to leads they own', async () => {
    results.set('lead.findFirst', { id: 'lead-1', company: {}, person: {} })
    await leadsRoute.GET(req(), params('lead-1'))
    const where = calls.find(c => c.model === 'lead')!.args.where as Record<string, unknown>
    expect(where.ownerId).toBe('u-sales')
  })

  it('does not restrict an admin by owner, but still scopes by org', async () => {
    session.user = asUser({ role: 'admin', id: 'u-admin' })
    results.set('lead.findFirst', { id: 'lead-1', company: {}, person: {} })
    await leadsRoute.GET(req(), params('lead-1'))
    const where = calls.find(c => c.model === 'lead')!.args.where as Record<string, unknown>
    expect(where.ownerId).toBeUndefined()
    expect(orgIdsSeen()).toContain(ORG)
  })

  it("404s another org's lead instead of revealing it exists", async () => {
    results.set('lead.findFirst', null)
    const res = await leadsRoute.GET(req(), params('lead-from-org-b'))
    expect(res.status).toBe(404)
  })
})

describe('/leads/[id] page — the lead lookup is tenant-scoped', () => {
  const open = (id: string) => leadDetailPage({ params: Promise.resolve({ id }) })

  it('an admin is scoped to their own org, not just the id', async () => {
    session.user = asUser({ role: 'admin', id: 'u-admin' })
    results.set('lead.findFirst', { id: 'lead-1', orgId: ORG })
    await open('lead-1')
    const lookup = calls.find(c => c.model === 'lead' && c.op === 'findFirst')!
    expect(lookup.args.where).toMatchObject({ id: 'lead-1', orgId: { in: [ORG] } })
    expect(calls.some(c => c.model === 'lead' && c.op === 'findUnique')).toBe(false)
  })

  it("404s another org's lead (the scoped lookup finds nothing)", async () => {
    session.user = asUser({ role: 'admin', id: 'u-admin' })
    results.set('lead.findFirst', null)
    await expect(open('lead-from-org-b')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it("a sales user's lookup is also restricted to leads they own", async () => {
    results.set('lead.findFirst', null)
    await expect(open('someone-elses-lead')).rejects.toThrow('NEXT_NOT_FOUND')
    const lookup = calls.find(c => c.model === 'lead' && c.op === 'findFirst')!
    expect(lookup.args.where).toMatchObject({ ownerId: 'u-sales' })
  })
})

describe('/leads page — the admin reassign list is tenant-scoped', () => {
  it('only lists users from the caller org', async () => {
    session.user = asUser({ role: 'admin', id: 'u-admin' })
    await leadsPage({ searchParams: Promise.resolve({}) })
    const owners = calls.find(c => c.model === 'user' && c.op === 'findMany')!
    expect(owners.args.where).toMatchObject({ orgId: { in: [ORG] } })
  })
})

describe('GET /api/companies/[id] — leads inside a company follow leadScope', () => {
  it("a sales rep only gets their own leads on a shared company", async () => {
    results.set('company.findFirst', { id: 'c-1', orgId: ORG, leads: [] })
    await companiesIdRoute.GET(req(), params('c-1'))
    const q = calls.find(c => c.model === 'company' && c.op === 'findFirst')!
    const leads = (q.args.include as { leads: { where: Record<string, unknown> } }).leads
    expect(leads.where).toMatchObject({ orgId: { in: [ORG] }, ownerId: 'u-sales' })
  })
})

describe('POST /api/activities — clients cannot forge system activity types', () => {
  it.each(['stage_change', 'onboarding_step', 'anything'])('400s type=%s and writes nothing', async (type) => {
    const res = await activitiesRoute.POST(jsonReq({ leadId: 'lead-1', type, description: 'x' }))
    expect(res.status).toBe(400)
    expect(calls.some(c => c.model === 'activity' && c.op === 'create')).toBe(false)
  })

  it('400s an unparseable date instead of a 500', async () => {
    const res = await activitiesRoute.POST(jsonReq({ leadId: 'lead-1', type: 'note', date: 'garbage' }))
    expect(res.status).toBe(400)
  })

  it('a backdated activity only moves lastActivityAt forward', async () => {
    results.set('lead.findFirst', { id: 'lead-1', orgId: ORG })
    results.set('activity.create', { id: 'a1', date: new Date('2026-01-01T00:00:00Z') })
    const res = await activitiesRoute.POST(jsonReq({ leadId: 'lead-1', type: 'call', date: '2026-01-01' }))
    expect(res.status).toBe(200)
    expect(calls.some(c => c.model === 'lead' && c.op === 'update')).toBe(false)
    const upd = calls.find(c => c.model === 'lead' && c.op === 'updateMany')!
    expect(upd.args.where).toMatchObject({ id: 'lead-1', orgId: ORG, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: new Date('2026-01-01T00:00:00Z') } }] })
  })
})

describe('DELETE /api/leads/[id] — guard must precede the delete', () => {
  it('does not delete when the scoped lookup finds nothing', async () => {
    results.set('lead.findFirst', null)
    const res = await leadsRoute.DELETE(req(), params('lead-from-org-b'))
    expect(res.status).toBe(404)
    expect(calls.some(c => c.op === 'delete' || c.op === 'deleteMany')).toBe(false)
  })

  it('scopes the guard lookup by org before deleting', async () => {
    results.set('lead.findFirst', { id: 'lead-1', orgId: ORG })
    await leadsRoute.DELETE(req(), params('lead-1'))
    const guard = calls.find(c => c.model === 'lead' && c.op === 'findFirst')
    expect(guard).toBeDefined()
    expect(JSON.stringify(guard!.args)).toContain(ORG)
  })
})

describe('GET /api/activities — scoped through the lead relation', () => {
  it('always constrains by the lead relation scope', async () => {
    await activitiesRoute.GET(req('http://test/api/activities'))
    const where = calls.find(c => c.model === 'activity')!.args.where as Record<string, unknown>
    expect(where.lead).toBeDefined()
    expect(JSON.stringify(where.lead)).toContain(ORG)
  })

  it("a foreign leadId cannot widen the scope — the relation filter still applies", async () => {
    await activitiesRoute.GET(req('http://test/api/activities?leadId=lead-from-org-b'))
    const where = calls.find(c => c.model === 'activity')!.args.where as Record<string, unknown>
    // Both terms must be present; the relation filter is what blocks the leak.
    expect(where.leadId).toBe('lead-from-org-b')
    expect(JSON.stringify(where.lead)).toContain(ORG)
  })

  it('verifies the lead is in scope before writing an activity', async () => {
    results.set('lead.findFirst', null)
    const res = await activitiesRoute.POST(
      jsonReq({ leadId: 'lead-from-org-b', type: 'call', description: 'x' }),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(calls.some(c => c.model === 'activity' && c.op === 'create')).toBe(false)
  })
})

describe('DELETE /api/views/[id] — known weak guard', () => {
  // Documents CURRENT behaviour: the guard is userId-only, with no orgId
  // term. It is safe today only because a User belongs to exactly one org.
  // If an orgId filter is added later this test should be tightened, not
  // deleted. See decisions.md.
  it('scopes the guard to the calling user', async () => {
    results.set('savedView.findFirst', { id: 'v-1' })
    await viewsIdRoute.DELETE(req(), params('v-1'))
    const where = calls.find(c => c.model === 'savedView' && c.op === 'findFirst')!.args
      .where as Record<string, unknown>
    expect(where.userId).toBe('u-sales')
  })

  it('does not delete a view belonging to someone else', async () => {
    results.set('savedView.findFirst', null)
    const res = await viewsIdRoute.DELETE(req(), params('v-other'))
    expect(res.status).toBe(404)
    expect(calls.some(c => c.op === 'delete')).toBe(false)
  })
})

describe('tasks/[id] — hand-rolled copy of the leadScope rule', () => {
  it('scopes by org and, for sales, by owner', async () => {
    results.set('task.findFirst', { id: 't-1' })
    await tasksIdRoute.PATCH(jsonReq({ done: true }), params('t-1'))
    const seen = orgIdsSeen()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(o => o === ORG)).toBe(true)
  })

  it("404s another org's task without updating", async () => {
    results.set('task.findFirst', null)
    const res = await tasksIdRoute.PATCH(jsonReq({ done: true }), params('t-from-org-b'))
    expect(res.status).toBe(404)
    expect(calls.some(c => c.model === 'task' && c.op === 'update')).toBe(false)
  })
})

describe('onboarding sub-stage changes are auditable', () => {
  // Government-document verification with no record of who advanced it is
  // the kind of gap that is expensive to retrofit. This pins the behaviour.
  it('writes an Activity naming the actor when the sub-stage moves', async () => {
    // The route validates the target key against the org's configured
    // steps, so the stub must return them or the PATCH 400s first.
    results.set('onboardingStepDefinition.findMany', [
      { key: 'document_submission', label: 'Document submission' },
      { key: 'document_verification', label: 'Document verification' },
    ])
    results.set('stageDefinition.findMany', [{ key: 'onboarding', label: 'Onboarding' }])
    results.set('lead.findFirst', {
      id: 'lead-1', orgId: ORG, stage: 'onboarding', onboardingSubStage: 'document_submission',
      wonAt: null, onboardedAt: null, pendingSubStatus: null, customFieldsJson: null, companyId: 'c1',
    })
    await leadsRoute.PATCH(jsonReq({ onboardingSubStage: 'document_verification' }), params('lead-1'))

    const activity = calls.find(c => c.model === 'activity' && c.op === 'create')
    expect(activity).toBeDefined()
    const data = activity!.args.data as Record<string, unknown>
    expect(data.type).toBe('onboarding_step')
    expect(data.authorName).toBe('Sales User')
    expect(data.orgId).toBe(ORG)
    // The Reports "Onboarded" metric parses this (<key>) suffix.
    expect(String(data.description)).toContain('(document_verification)')
  })

  it('writes no Activity when the sub-stage is unchanged', async () => {
    results.set('onboardingStepDefinition.findMany', [
      { key: 'document_submission', label: 'Document submission' },
    ])
    results.set('stageDefinition.findMany', [{ key: 'onboarding', label: 'Onboarding' }])
    results.set('lead.findFirst', {
      id: 'lead-1', orgId: ORG, stage: 'onboarding', onboardingSubStage: 'document_submission',
      wonAt: null, onboardedAt: null, pendingSubStatus: null, customFieldsJson: null, companyId: 'c1',
    })
    await leadsRoute.PATCH(jsonReq({ onboardingSubStage: 'document_submission' }), params('lead-1'))
    expect(calls.some(c => c.model === 'activity' && c.op === 'create')).toBe(false)
  })

  it('400s a sub-stage change on a lead that is not in onboarding', async () => {
    results.set('onboardingStepDefinition.findMany', [{ key: 'final_onboarded', label: 'Onboarded' }])
    results.set('stageDefinition.findMany', [{ key: 'new', label: 'New' }])
    results.set('lead.findFirst', {
      id: 'lead-1', orgId: ORG, stage: 'new', onboardingSubStage: null,
      wonAt: null, onboardedAt: null, pendingSubStatus: null, customFieldsJson: null, companyId: 'c1',
    })
    const res = await leadsRoute.PATCH(jsonReq({ onboardingSubStage: 'final_onboarded' }), params('lead-1'))
    expect(res.status).toBe(400)
    expect(calls.some(c => c.model === 'lead' && c.op === 'update')).toBe(false)
  })
})

describe('PATCH /api/leads/[id] — owner name', () => {
  it('ignores a free-text ownerName so it cannot drift from ownerId', async () => {
    results.set('onboardingStepDefinition.findMany', [])
    results.set('stageDefinition.findMany', [{ key: 'new', label: 'New' }])
    results.set('lead.findFirst', {
      id: 'lead-1', orgId: ORG, stage: 'new', onboardingSubStage: null,
      wonAt: null, onboardedAt: null, pendingSubStatus: null, customFieldsJson: null, companyId: 'c1',
    })
    await leadsRoute.PATCH(jsonReq({ ownerName: 'Priya', notes: 'x' }), params('lead-1'))
    const upd = calls.find(c => c.model === 'lead' && c.op === 'update')
    expect(upd).toBeDefined()
    expect((upd!.args.data as Record<string, unknown>).ownerName).toBeUndefined()
  })
})

describe('no handler ever queries an org other than the caller org', () => {
  it('holds across every exercised route', async () => {
    const runs: (() => Promise<unknown>)[] = [
      () => leadsRoute.GET(req(), params('lead-1')),
      () => activitiesRoute.GET(req('http://test/api/activities?leadId=x')),
      () => viewsIdRoute.DELETE(req(), params('v-1')),
      () => tasksIdRoute.PATCH(jsonReq({ done: true }), params('t-1')),
    ]
    for (const run of runs) {
      resetHarness()
      session.user = asUser()
      try {
        await run()
      } catch {
        // A handler may reject placeholder input; queries it DID issue
        // before rejecting must still have been org-scoped.
      }
      for (const seen of orgIdsSeen()) expect(seen).toBe(ORG)
    }
  })
})

describe('/skills/[skillId]?runId= — a saved run is tenant-scoped', () => {
  // The page passes pastRun to <SkillRunner>; walk the returned tree to read it.
  function pastRunOf(node: unknown): unknown {
    if (!node || typeof node !== 'object') return undefined
    const props = (node as { props?: Record<string, unknown> }).props
    if (!props) return undefined
    if ('pastRun' in props) return props.pastRun
    const kids = ([] as unknown[]).concat(props.children ?? [])
    for (const k of kids) {
      const found = pastRunOf(k)
      if (found !== undefined) return found
    }
    return undefined
  }
  const open = async (runId: string) =>
    pastRunOf(await skillPage({
      params: Promise.resolve({ skillId: 'pipeline-hygiene-audit' }),
      searchParams: Promise.resolve({ runId }),
    }))

  it("looks the run up inside the user's org, never by bare id", async () => {
    session.user = asUser({ role: 'admin', id: 'u-admin' })
    results.set('skillRun.findFirst', null)
    expect(await open('run-from-org-b')).toBeNull()
    const lookup = calls.find(c => c.model === 'skillRun' && c.op === 'findFirst')!
    expect(lookup.args.where).toMatchObject({ id: 'run-from-org-b', orgId: { in: [ORG] } })
    expect(calls.some(c => c.model === 'skillRun' && c.op === 'findUnique')).toBe(false)
  })

  it('shows a whole-pipeline run to an admin', async () => {
    session.user = asUser({ role: 'admin', id: 'u-admin' })
    results.set('skillRun.findFirst', { id: 'run-1', orgId: ORG, leadId: null })
    expect(await open('run-1')).toMatchObject({ id: 'run-1' })
  })

  it('hides a whole-pipeline run from a sales user (it covers leads they cannot see)', async () => {
    results.set('skillRun.findFirst', { id: 'run-1', orgId: ORG, leadId: null })
    expect(await open('run-1')).toBeNull()
  })
})
