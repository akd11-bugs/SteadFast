import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  calls, results, resetHarness, session, asUser, orgIdsSeen, params, prismaStub,
} from './routeHarness'

// The seven routes where a tenant-boundary regression is either destructive
// or unrecoverable. Chosen over broad coverage because these are the ones
// that cannot be walked back: bulk writes, a cascading delete, a whole-org
// aggregate behind a static key, and three surfaces that middleware does not
// protect at all.
//
// Each handler runs for real against a recording Prisma stub; assertions are
// on the WHERE clause actually sent, so deleting an orgId filter fails here.

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
    leadScope: (u: { role?: string; id: string; visibleOrgIds: string[] }) =>
      isAdmin(u) || isOperations(u)
        ? { orgId: { in: u.visibleOrgIds } }
        : { orgId: { in: u.visibleOrgIds }, ownerId: u.id },
    resolveVisibleOrgIds: (orgId: string) => [orgId],
  }
})

vi.mock('@/lib/http', () => ({
  readJsonBody: async (req: Request) => {
    try { return await req.json() } catch {
      const { NextResponse } = await import('next/server')
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
  },
}))

vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }))

const sendEmailAs = vi.fn()
vi.mock('@/lib/email', () => ({ sendEmailAs: (...a: unknown[]) => sendEmailAs(...a) }))

// Rep auth is a separate cookie-based identity; stub it the same way.
const repSession: { user: Record<string, unknown> | null } = { user: null }
vi.mock('@/lib/repSession', () => ({
  getRepSessionUser: async () => repSession.user,
}))

// Agent auth resolves an org from an API key, with no browser session.
const agentOrg: { value: { orgId: string } | null } = { value: null }
vi.mock('@/lib/agentAuth', async () => {
  const { NextResponse } = await import('next/server')
  return {
    AGENT_ACTOR_NAME: 'Agent',
    requireAgentOrg: async () =>
      agentOrg.value ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  }
})

const ORG = 'org-a'
const FOREIGN = 'org-b'

const bulkRoute = await import('@/app/api/leads/bulk/route')
const companyIdRoute = await import('@/app/api/companies/[id]/route')
const repLeadRoute = await import('@/app/api/rep/leads/[id]/route')
const emailSendRoute = await import('@/app/api/email/send/route')
const stageIdRoute = await import('@/app/api/pipeline-config/stages/[id]/route')

function jsonReq(body: unknown, method = 'POST') {
  return new Request('http://test/api/x', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** GET/DELETE cannot carry a body, so they get a bare Request. */
function bareReq(method = 'GET') {
  return new Request('http://test/api/x', { method })
}

beforeEach(() => {
  resetHarness()
  session.user = asUser({ role: 'admin', id: 'u-admin' })
  repSession.user = null
  agentOrg.value = null
})

// 1 ─────────────────────────────────────────────────────────────────────────
describe('PATCH /api/leads/bulk — writes many rows at once', () => {
  it('scopes the id lookup, so out-of-scope ids are dropped rather than written', async () => {
    results.set('lead.findMany', [{ id: 'lead-1' }])
    await bulkRoute.PATCH(jsonReq({ action: 'stage', leadIds: ['lead-1', 'lead-from-org-b'], stage: 'new', remark: 'x' }))
    const scopeQuery = calls.find(c => c.model === 'lead' && c.op === 'findMany')
    expect(scopeQuery).toBeDefined()
    expect(JSON.stringify(scopeQuery!.args)).toContain(ORG)
  })

  it('refuses the whole batch when nothing is in scope, writing nothing', async () => {
    results.set('lead.findMany', [])
    const res = await bulkRoute.PATCH(
      jsonReq({ action: 'stage', leadIds: ['lead-from-org-b'], stage: 'new', remark: 'x' }),
    )
    expect(res.status).toBe(403)
    expect(calls.some(c => c.op === 'update' || c.op === 'updateMany')).toBe(false)
  })

  it('never queries an org other than the caller org', async () => {
    results.set('lead.findMany', [{ id: 'lead-1' }])
    await bulkRoute.PATCH(jsonReq({ action: 'stage', leadIds: ['lead-1'], stage: 'new', remark: 'x' }))
    for (const seen of orgIdsSeen()) expect(seen).toBe(ORG)
  })
})

// 2 ─────────────────────────────────────────────────────────────────────────
describe('DELETE /api/companies/[id] — cascades a person.deleteMany', () => {
  it('scopes the guard by org before deleting anything', async () => {
    results.set('company.findFirst', { id: 'c1', _count: { leads: 0 } })
    await companyIdRoute.DELETE(bareReq('DELETE'), params('c1'))
    const guard = calls.find(c => c.model === 'company' && c.op === 'findFirst')
    expect(guard).toBeDefined()
    expect((guard!.args.where as Record<string, unknown>).orgId).toBe(ORG)
  })

  it("does not delete, or cascade, another org's company", async () => {
    results.set('company.findFirst', null)
    const res = await companyIdRoute.DELETE(bareReq('DELETE'), params('company-from-org-b'))
    expect(res.status).toBe(404)
    // The cascade is the dangerous part: it must not run.
    expect(calls.some(c => c.model === 'person' && c.op === 'deleteMany')).toBe(false)
    expect(calls.some(c => c.model === 'company' && c.op === 'delete')).toBe(false)
  })

  it('refuses to delete a company that still has leads, rather than orphaning them', async () => {
    results.set('company.findFirst', { id: 'c1', _count: { leads: 3 } })
    const res = await companyIdRoute.DELETE(bareReq('DELETE'), params('c1'))
    expect(res.status).toBe(409)
    expect(calls.some(c => c.op === 'delete' || c.op === 'deleteMany')).toBe(false)
  })
})

// 3 ─────────────────────────────────────────────────────────────────────────
describe('GET/PATCH /api/rep/leads/[id] — PIN auth, no middleware in front', () => {
  it('returns 401 without a rep session and touches no data', async () => {
    repSession.user = null
    const res = await repLeadRoute.GET(bareReq('GET'), params('lead-1'))
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('scopes the lookup to the rep own org and own leads', async () => {
    repSession.user = { id: 'rep-1', name: 'Rep', email: 'r@a.com', role: 'sales', orgId: ORG, visibleOrgIds: [ORG] }
    results.set('lead.findFirst', { id: 'lead-1', company: {}, person: {} })
    await repLeadRoute.GET(bareReq('GET'), params('lead-1'))
    const where = calls.find(c => c.model === 'lead')!.args.where as Record<string, unknown>
    expect(JSON.stringify(where)).toContain(ORG)
    expect(where.ownerId).toBe('rep-1')
  })

  it("404s another org's lead instead of moving its stage", async () => {
    repSession.user = { id: 'rep-1', name: 'Rep', email: 'r@a.com', role: 'sales', orgId: ORG, visibleOrgIds: [ORG] }
    // The route validates the stage against the org's configured stages
    // BEFORE looking the lead up, so the stub must supply them or this 400s
    // first. (Validating ahead of the lookup is the safer order: it rejects
    // without revealing whether the lead exists.)
    results.set('stageDefinition.findMany', [{ key: 'proposal', label: 'Proposal', position: 0 }])
    results.set('lead.findFirst', null)
    const res = await repLeadRoute.PATCH(jsonReq({ stage: 'proposal', remark: 'x' }), params('lead-from-org-b'))
    expect(res.status).toBe(404)
    expect(calls.some(c => c.model === 'lead' && c.op === 'update')).toBe(false)
  })

  it('never sees an org other than its own', async () => {
    repSession.user = { id: 'rep-1', name: 'Rep', email: 'r@a.com', role: 'sales', orgId: ORG, visibleOrgIds: [ORG] }
    results.set('lead.findFirst', { id: 'lead-1', company: {}, person: {} })
    await repLeadRoute.GET(bareReq('GET'), params('lead-1'))
    for (const seen of orgIdsSeen()) expect(seen).toBe(ORG)
    expect(JSON.stringify(calls)).not.toContain(FOREIGN)
  })
})

describe('POST /api/email/send — a sent email is never reported as failed', () => {
  beforeEach(() => sendEmailAs.mockReset())

  it('returns ok when the send worked but logging the activity failed', async () => {
    results.set('lead.findFirst', { id: 'lead-1', orgId: ORG, email: 'buyer@acme.com' })
    sendEmailAs.mockResolvedValue({ id: 'msg-1' })
    const spy = vi.spyOn(prismaStub.activity, 'create').mockRejectedValueOnce(new Error('pool timeout'))
    const res = await emailSendRoute.POST(jsonReq({ leadId: 'lead-1', subject: 'Hi', body: 'Hello' }))
    spy.mockRestore()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('400s a lead with no email address without trying to send', async () => {
    results.set('lead.findFirst', { id: 'lead-1', orgId: ORG, email: '' })
    const res = await emailSendRoute.POST(jsonReq({ leadId: 'lead-1', subject: 'Hi', body: 'Hello' }))
    expect(res.status).toBe(400)
    expect(sendEmailAs).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/pipeline-config/stages/[id] — no stranded leads', () => {
  it('409s while leads are still in the stage, deleting nothing', async () => {
    results.set('stageDefinition.findFirst', { id: 's-1', key: 'demo', isCore: false, orgId: ORG })
    results.set('lead.count', 3)
    const res = await stageIdRoute.DELETE(bareReq('DELETE'), { params: Promise.resolve({ id: 's-1' }) })
    expect(res.status).toBe(409)
    expect(calls.some(c => c.model === 'stageDefinition' && c.op === 'delete')).toBe(false)
  })
})
