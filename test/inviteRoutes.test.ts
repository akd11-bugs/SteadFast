import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  calls, results, resetHarness, session, asUser, params, prismaStub,
} from './routeHarness'

// The invite-link system: an admin creates an invite (one-person or a
// reusable link), and anyone holding the code redeems it on a PUBLIC route.
// Handlers run for real against the recording Prisma stub from routeHarness;
// Neon Auth (getSession + signUpNeonAuthAccount) and the rate limiter are
// mocked so nothing touches the network.

// routeHarness's stub has no `invite` model; add a recording one here with
// the same call/result conventions.
function op(model: string, name: string) {
  return (args: Record<string, unknown> = {}) => {
    calls.push({ model, op: name, args })
    const key = `${model}.${name}`
    if (results.has(key)) {
      const r = results.get(key)
      return typeof r === 'function' ? Promise.resolve().then(() => (r as (a: unknown) => unknown)(args)) : Promise.resolve(r)
    }
    if (name === 'findMany') return Promise.resolve([])
    if (name === 'updateMany') return Promise.resolve({ count: 0 })
    if (name === 'create' || name === 'update') return Promise.resolve({ id: 'row-1', ...((args.data as object) ?? {}) })
    return Promise.resolve(null)
  }
}
Object.assign(prismaStub, {
  invite: {
    findMany: op('invite', 'findMany'),
    findFirst: op('invite', 'findFirst'),
    findUnique: op('invite', 'findUnique'),
    create: op('invite', 'create'),
    update: op('invite', 'update'),
    updateMany: op('invite', 'updateMany'),
  },
})

vi.mock('@/lib/db', () => ({ prisma: prismaStub }))

vi.mock('@/lib/session', async () => {
  const { NextResponse } = await import('next/server')
  const { session } = await import('./routeHarness')
  return {
    isAdmin: (u: { role?: string }) => u?.role === 'admin',
    requireApiUser: async () =>
      session.user ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
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

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}))

const neonSession: { email: string | null } = { email: null }
const signUp = vi.fn<(input: { email: string; password: string; name: string }) => Promise<{ ok: true } | { ok: false; message: string }>>()
vi.mock('@/lib/auth', () => ({
  neonAuth: {
    getSession: async () => ({ data: neonSession.email ? { user: { email: neonSession.email } } : null }),
  },
  signUpNeonAuthAccount: (input: { email: string; password: string; name: string }) => signUp(input),
}))

const invitesRoute = await import('@/app/api/invites/route')
const inviteIdRoute = await import('@/app/api/invites/[id]/route')
const redeemRoute = await import('@/app/api/invites/redeem/route')

function jsonReq(body: unknown, method = 'POST') {
  return new Request('http://test/api/x', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const admin = () => asUser({ id: 'u-admin', role: 'admin', orgId: 'org-a', visibleOrgIds: ['org-a'] })

const onePerson = {
  id: 'inv-1', orgId: 'org-a', name: 'Priya', role: 'operations', isReusable: false, status: 'pending', code: 'ABC123',
}
const reusable = { ...onePerson, id: 'inv-2', name: null, role: 'sales', isReusable: true, code: 'REUSE1' }

const callsOf = (model: string, opName: string) => calls.filter((c) => c.model === model && c.op === opName)

beforeEach(() => {
  resetHarness()
  session.user = null
  neonSession.email = null
  signUp.mockReset()
  signUp.mockResolvedValue({ ok: true })
})

describe('POST /api/invites', () => {
  it('403s a non-admin', async () => {
    session.user = asUser()
    const res = await invitesRoute.POST(jsonReq({ name: 'X' }))
    expect(res.status).toBe(403)
    expect(callsOf('invite', 'create')).toHaveLength(0)
  })

  it('400s a one-person invite without a name', async () => {
    session.user = admin()
    const res = await invitesRoute.POST(jsonReq({ name: '   ', role: 'sales' }))
    expect(res.status).toBe(400)
    expect(callsOf('invite', 'create')).toHaveLength(0)
  })

  it('takes orgId from the session, never the body', async () => {
    session.user = admin()
    const res = await invitesRoute.POST(jsonReq({ name: 'Priya', role: 'operations', orgId: 'org-b' }))
    expect(res.status).toBe(200)
    const data = callsOf('invite', 'create')[0].args.data as Record<string, unknown>
    expect(data.orgId).toBe('org-a')
    expect(data.role).toBe('operations')
    expect(data.isReusable).toBe(false)
    expect(data.createdById).toBe('u-admin')
    expect(typeof data.code).toBe('string')
  })

  it('falls back to sales for a role outside admin/sales/operations', async () => {
    session.user = admin()
    await invitesRoute.POST(jsonReq({ isReusable: true, role: 'superuser' }))
    const data = callsOf('invite', 'create')[0].args.data as Record<string, unknown>
    expect(data.role).toBe('sales')
    expect(data.name).toBeNull()
    expect(data.isReusable).toBe(true)
  })
})

describe('PATCH /api/invites/[id]', () => {
  it("404s another org's invite, scoping the lookup to visibleOrgIds", async () => {
    session.user = admin()
    // findFirst returns null: the org filter excluded org-b's row.
    const res = await inviteIdRoute.PATCH(new Request('http://test', { method: 'PATCH' }), params('inv-foreign'))
    expect(res.status).toBe(404)
    expect(callsOf('invite', 'findFirst')[0].args.where).toEqual({ id: 'inv-foreign', orgId: { in: ['org-a'] } })
    expect(callsOf('invite', 'update')).toHaveLength(0)
  })

  it('400s revoking an invite that is not pending', async () => {
    session.user = admin()
    results.set('invite.findFirst', { ...onePerson, status: 'redeemed' })
    const res = await inviteIdRoute.PATCH(new Request('http://test', { method: 'PATCH' }), params('inv-1'))
    expect(res.status).toBe(400)
    expect(callsOf('invite', 'update')).toHaveLength(0)
  })

  it('revokes a pending invite, only if it is still pending at write time', async () => {
    session.user = admin()
    results.set('invite.findFirst', onePerson)
    results.set('invite.updateMany', { count: 1 })
    const res = await inviteIdRoute.PATCH(new Request('http://test', { method: 'PATCH' }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(callsOf('invite', 'updateMany')[0].args).toEqual({ where: { id: 'inv-1', status: 'pending' }, data: { status: 'revoked' } })
  })

  it('400s when a redeem claimed the invite between the read and the revoke', async () => {
    session.user = admin()
    results.set('invite.findFirst', onePerson)
    results.set('invite.updateMany', { count: 0 })
    const res = await inviteIdRoute.PATCH(new Request('http://test', { method: 'PATCH' }), params('inv-1'))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/invites/redeem', () => {
  const cold = { code: 'ABC123', email: 'Priya@Example.com', password: 'longenough1' }

  it.each([
    ['unknown', null],
    ['revoked', { ...onePerson, status: 'revoked' }],
    ['already redeemed', { ...onePerson, status: 'redeemed' }],
  ])('410s an %s code without creating anything', async (_label, row) => {
    results.set('invite.findUnique', row)
    const res = await redeemRoute.POST(jsonReq(cold))
    expect(res.status).toBe(410)
    expect(signUp).not.toHaveBeenCalled()
    expect(callsOf('user', 'create')).toHaveLength(0)
  })

  it("cold path: creates the Neon Auth identity, then a User row in the invite's org and role", async () => {
    results.set('invite.findUnique', onePerson)
    results.set('invite.updateMany', { count: 1 })
    results.set('user.create', { id: 'u-new' })
    const res = await redeemRoute.POST(jsonReq(cold))
    expect(res.status).toBe(200)
    expect(signUp).toHaveBeenCalledWith({ email: 'priya@example.com', password: 'longenough1', name: 'Priya' })
    expect(callsOf('invite', 'updateMany')[0].args).toMatchObject({ where: { code: 'ABC123', status: 'pending' }, data: { status: 'redeemed' } })
    const data = callsOf('user', 'create')[0].args.data as Record<string, unknown>
    expect(data).toMatchObject({ orgId: 'org-a', role: 'operations', name: 'Priya', email: 'priya@example.com', passwordHash: null })
    // The invite is claimed before the User row is created.
    const createIdx = calls.findIndex((c) => c.model === 'user' && c.op === 'create')
    const claimIdx = calls.findIndex((c) => c.model === 'invite' && c.op === 'updateMany')
    expect(claimIdx).toBeLessThan(createIdx)
  })

  it('400s a password under 8 characters on the cold path', async () => {
    results.set('invite.findUnique', onePerson)
    const res = await redeemRoute.POST(jsonReq({ ...cold, password: 'short' }))
    expect(res.status).toBe(400)
    expect(callsOf('invite', 'updateMany')).toHaveLength(0)
    expect(signUp).not.toHaveBeenCalled()
  })

  it('releases a one-person invite back to pending when signUp fails', async () => {
    results.set('invite.findUnique', onePerson)
    results.set('invite.updateMany', { count: 1 })
    signUp.mockResolvedValue({ ok: false, message: 'User already exists' })
    const res = await redeemRoute.POST(jsonReq(cold))
    expect(res.status).toBe(409)
    expect(callsOf('invite', 'update')[0].args).toEqual({ where: { id: 'inv-1' }, data: { status: 'pending', redeemedAt: null } })
    expect(callsOf('user', 'create')).toHaveLength(0)
  })

  it("never consumes a reusable invite and uses the redeemer's own name", async () => {
    results.set('invite.findUnique', reusable)
    results.set('user.create', { id: 'u-new' })
    const res = await redeemRoute.POST(jsonReq({ ...cold, code: 'REUSE1', name: '  Ravi  ' }))
    expect(res.status).toBe(200)
    expect(callsOf('invite', 'updateMany')).toHaveLength(0)
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ravi' }))
    expect(callsOf('user', 'create')[0].args.data).toMatchObject({ name: 'Ravi', role: 'sales', orgId: 'org-a' })
    // The only invite write is the redeemedByUserId pointer, not a status change.
    for (const c of callsOf('invite', 'update')) {
      expect((c.args.data as Record<string, unknown>).status).toBeUndefined()
    }
  })

  it('Google-session path: skips signUp and uses the session email, ignoring the body', async () => {
    neonSession.email = 'Google.User@Gmail.com'
    results.set('invite.findUnique', onePerson)
    results.set('invite.updateMany', { count: 1 })
    results.set('user.create', { id: 'u-new' })
    const res = await redeemRoute.POST(jsonReq({ code: 'ABC123', email: 'attacker@evil.com' }))
    expect(res.status).toBe(200)
    expect(signUp).not.toHaveBeenCalled()
    expect(callsOf('user', 'findUnique')[0].args.where).toEqual({ email: 'google.user@gmail.com' })
    expect(callsOf('user', 'create')[0].args.data).toMatchObject({ email: 'google.user@gmail.com', orgId: 'org-a' })
  })

  it('410s a junk code even for a registered email, so the route cannot be used to look up emails', async () => {
    results.set('user.findUnique', { id: 'u-existing' })
    results.set('invite.findUnique', null)
    const res = await redeemRoute.POST(jsonReq({ ...cold, code: 'junk' }))
    expect(res.status).toBe(410)
  })

  it("uses the name the invitee typed on a one-person invite, falling back to the admin's", async () => {
    results.set('invite.findUnique', onePerson)
    results.set('invite.updateMany', { count: 1 })
    results.set('user.create', { id: 'u-new' })
    await redeemRoute.POST(jsonReq({ ...cold, name: 'Priya Raman' }))
    expect(callsOf('user', 'create')[0].args.data).toMatchObject({ name: 'Priya Raman' })
  })

  it('turns "already exists" from Neon Auth into a sign-in-first message', async () => {
    results.set('invite.findUnique', onePerson)
    results.set('invite.updateMany', { count: 1 })
    signUp.mockResolvedValue({ ok: false, message: 'User already exists. Use another email.' })
    const res = await redeemRoute.POST(jsonReq(cold))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Sign in with it first/)
  })

  it("signed in with an existing account: moves it into the invite's org and role", async () => {
    neonSession.email = 'lead@othercorp.com'
    results.set('invite.findUnique', onePerson)
    results.set('invite.updateMany', { count: 1 })
    results.set('user.findUnique', { id: 'u-old', orgId: 'org-z', role: 'sales', name: 'Lee' })
    const res = await redeemRoute.POST(jsonReq({ code: 'ABC123', name: 'Lee' }))
    expect(res.status).toBe(200)
    expect(signUp).not.toHaveBeenCalled()
    expect(callsOf('user', 'create')).toHaveLength(0)
    expect(callsOf('user', 'update')[0].args).toEqual({
      where: { id: 'u-old' },
      // The old org's admin chose that rep PIN; it must not work at the new org.
      data: { orgId: 'org-a', role: 'operations', isActive: true, pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null },
    })
  })

  it("won't move the only admin out of a workspace that still has members", async () => {
    neonSession.email = 'boss@othercorp.com'
    results.set('invite.findUnique', onePerson)
    results.set('user.findUnique', { id: 'u-boss', orgId: 'org-z', role: 'admin', name: 'Boss' })
    const counts = [0, 3] // other admins, other members
    const users = prismaStub.user as unknown as { count: () => Promise<number> }
    const realCount = users.count
    users.count = () => Promise.resolve(counts.shift() ?? 0)
    const res = await redeemRoute.POST(jsonReq({ code: 'ABC123', name: 'Boss' })).finally(() => { users.count = realCount })
    expect(res.status).toBe(409)
    expect(callsOf('invite', 'updateMany')).toHaveLength(0)
  })

  it('409s an email that already has a User row, before touching the invite', async () => {
    results.set('user.findUnique', { id: 'u-existing' })
    results.set('invite.findUnique', onePerson)
    const res = await redeemRoute.POST(jsonReq(cold))
    expect(res.status).toBe(409)
    expect(callsOf('invite', 'updateMany')).toHaveLength(0)
    expect(signUp).not.toHaveBeenCalled()
  })

  it('410s the loser of a concurrent claim (updateMany count 0)', async () => {
    results.set('invite.findUnique', onePerson)
    results.set('invite.updateMany', { count: 0 })
    const res = await redeemRoute.POST(jsonReq(cold))
    expect(res.status).toBe(410)
    expect(signUp).not.toHaveBeenCalled()
    expect(callsOf('user', 'create')).toHaveLength(0)
  })

  // Neon Auth identity created, then our User row fails (e.g. a second
  // person redeemed a reusable link with the same email a moment earlier ->
  // unique violation). It must be a handled error with the invite released,
  // not an uncaught throw that burns the code.
  it('handles a User-row failure after signUp succeeded (releases the invite, no throw)', async () => {
    results.set('invite.findUnique', onePerson)
    results.set('invite.updateMany', { count: 1 })
    // routeHarness returns a stored result as-is (never calls it), so swap
    // in a rejecting create for this one test.
    const users = prismaStub.user as { create: (a: unknown) => Promise<unknown> }
    const realCreate = users.create
    users.create = () => Promise.reject(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
    const res = await redeemRoute.POST(jsonReq(cold)).finally(() => { users.create = realCreate })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(callsOf('invite', 'update').some((c) => (c.args.data as Record<string, unknown>).status === 'pending')).toBe(true)
  })
})
