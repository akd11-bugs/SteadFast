import { describe, expect, it, beforeEach, vi } from 'vitest'
import { calls, results, resetHarness, session, asUser, params, prismaStub } from './routeHarness'

// vi.mock is hoisted, so these must sit at this file's top level.
vi.mock('@/lib/db', () => ({ prisma: prismaStub }))
vi.mock('@/lib/session', async () => {
  const { NextResponse } = await import('next/server')
  const { session } = await import('./routeHarness')
  return {
    isAdmin: (u: { role?: string }) => u?.role === 'admin',
    isOperations: (u: { role?: string }) => u?.role === 'operations',
    requireApiUser: async () => session.user ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
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

// Record-engine routes, run against an in-memory table per model whose
// findFirst/findMany/count/deleteMany honour the WHERE clause the route sent
// (equality, { in }, OR, and the `records: { none }` guard). A route that
// drops orgId or ownerId from its WHERE therefore sees the other row and
// fails these tests.

const objectsRoute = await import('@/app/api/objects/route')
const objectIdRoute = await import('@/app/api/objects/[id]/route')
const fieldsRoute = await import('@/app/api/objects/[id]/fields/route')
const fieldIdRoute = await import('@/app/api/fields/[id]/route')
const recordsRoute = await import('@/app/api/objects/[id]/records/route')
const recordIdRoute = await import('@/app/api/records/[id]/route')

type Row = { [k: string]: unknown }
const db: { [model: string]: Row[] } = {}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((w) => matches(row, w))
    if (k === 'records') return !db.objectRecord.some((r) => r.objectTypeId === row.id)
    // JSON path filter: { path: ['a'], equals: x }
    if (cond && typeof cond === 'object' && 'path' in cond) {
      const { path, equals } = cond as { path: string[]; equals: unknown }
      return path.reduce<unknown>((v, p) => (v as Row | undefined)?.[p], row[k]) === equals
    }
    if (cond && typeof cond === 'object' && 'in' in cond) return (cond as { in: unknown[] }).in.includes(row[k])
    return row[k] === cond
  })
}

function fake(model: string) {
  const m = prismaStub[model as 'objectType'] as unknown as { [op: string]: (a?: Row) => Promise<unknown> }
  const rec = (op: string, args: Row) => calls.push({ model, op, args })
  m.findFirst = async (args: Row = {}) => {
    rec('findFirst', args)
    const row = db[model].find((r) => matches(r, args.where as Row))
    if (!row) return null
    // `select: { objectType }` on a record — return its parent.
    if ((args.select as Row | undefined)?.objectType) return { objectType: db.objectType.find((o) => o.id === row.objectTypeId) }
    return row
  }
  m.findMany = async (args: Row = {}) => (rec('findMany', args), db[model].filter((r) => matches(r, args.where as Row)))
  m.count = async (args: Row = {}) => (rec('count', args), db[model].filter((r) => matches(r, args.where as Row)).length)
  m.deleteMany = async (args: Row = {}) => {
    rec('deleteMany', args)
    const before = db[model].length
    db[model] = db[model].filter((r) => !matches(r, args.where as Row))
    return { count: before - db[model].length }
  }
}

const ADMIN = { id: 'u-admin', role: 'admin' }
const OBJ_A = { id: 'obj-a', orgId: 'org-a', key: 'deals_ab12', name: 'Deals', icon: null, position: 0, restrictToOwner: true }
const OBJ_B = { id: 'obj-b', orgId: 'org-b', key: 'deals_cd34', name: 'Deals', icon: null, position: 0, restrictToOwner: false }
const FIELD_A = { id: 'f-a', orgId: 'org-a', objectTypeId: 'obj-a', key: 'title_x1y2', label: 'Title', type: 'text', config: {}, required: false, position: 0 }
const FIELD_B = { ...FIELD_A, id: 'f-b', orgId: 'org-b', objectTypeId: 'obj-b' }
// Self-link on obj-a and a person field, for reference checks.
const LINK_A = { ...FIELD_A, id: 'f-link', key: 'rel_k', label: 'Related', type: 'link', config: { targetObjectTypeId: 'obj-a' }, position: 1 }
const PERSON_A = { ...FIELD_A, id: 'f-person', key: 'rep_k', label: 'Rep', type: 'person', position: 2 }
const rec = (id: string, orgId: string, objectTypeId: string, ownerId: string) => ({
  id, orgId, objectTypeId, ownerId, values: { title_x1y2: 'x' }, createdById: ownerId, createdAt: new Date(), updatedAt: new Date(),
})

function jsonReq(body: unknown, method = 'POST') {
  return new Request('http://test/api/x', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
const get = (url = 'http://test/api/x') => new Request(url)

beforeEach(() => {
  resetHarness()
  db.objectType = [{ ...OBJ_A }, { ...OBJ_B }]
  db.objectField = [{ ...FIELD_A }]
  db.user = [
    { id: 'u-sales', orgId: 'org-a', isActive: true },
    { id: 'u-other', orgId: 'org-a', isActive: true },
    { id: 'u-b', orgId: 'org-b', isActive: true },
  ]
  db.objectRecord = [rec('r-mine', 'org-a', 'obj-a', 'u-sales'), rec('r-other', 'org-a', 'obj-a', 'u-other'), rec('r-b', 'org-b', 'obj-b', 'u-b')]
  for (const m of ['objectType', 'objectField', 'objectRecord', 'user']) fake(m)
  results.set('organization.findFirst', { recordEngineEnabled: true })
  session.user = asUser()
})

describe('engine flag', () => {
  it('returns 404 on every route when the org has the engine off', async () => {
    results.set('organization.findFirst', { recordEngineEnabled: false })
    session.user = asUser(ADMIN)
    expect((await objectsRoute.GET()).status).toBe(404)
    expect((await objectsRoute.POST(jsonReq({ name: 'X' }))).status).toBe(404)
    expect((await recordIdRoute.GET(get(), params('r-mine'))).status).toBe(404)
    expect(calls.some((c) => c.op === 'create')).toBe(false)
  })
})

describe('tenant boundary', () => {
  it("returns 404 for another org's object, by id or key", async () => {
    session.user = asUser(ADMIN)
    expect((await fieldsRoute.GET(get(), params('obj-b'))).status).toBe(404)
    expect((await recordsRoute.POST(jsonReq({ values: {} }), params('deals_cd34'))).status).toBe(404)
    expect((await objectIdRoute.DELETE(get(), params('obj-b'))).status).toBe(404)
    expect(db.objectType).toHaveLength(2)
  })

  it("returns 404 for another org's record on read, edit and delete", async () => {
    session.user = asUser(ADMIN)
    expect((await recordIdRoute.GET(get(), params('r-b'))).status).toBe(404)
    expect((await recordIdRoute.PATCH(jsonReq({ values: {} }, 'PATCH'), params('r-b'))).status).toBe(404)
    expect((await recordIdRoute.DELETE(get(), params('r-b'))).status).toBe(404)
    expect(db.objectRecord.some((r) => r.id === 'r-b')).toBe(true)
  })

  it("returns 404 when editing or deleting another org's field", async () => {
    session.user = asUser(ADMIN)
    db.objectField.push({ ...FIELD_B })
    expect((await fieldIdRoute.PATCH(jsonReq({ label: 'Hacked' }, 'PATCH'), params('f-b'))).status).toBe(404)
    expect((await fieldIdRoute.DELETE(get(), params('f-b'))).status).toBe(404)
    expect(db.objectField.find((f) => f.id === 'f-b')?.label).toBe('Title')
    expect(calls.some((c) => c.op === '$executeRaw' || c.op === 'update')).toBe(false)
  })

  it('rejects a link field whose target object is in another org', async () => {
    session.user = asUser(ADMIN)
    const res = await fieldsRoute.POST(jsonReq({ label: 'Co', type: 'link', config: { targetObjectTypeId: 'obj-b' } }), params('obj-a'))
    expect(res.status).toBe(400)
  })
})

describe('schema edits', () => {
  it('forbids sales from creating fields', async () => {
    const res = await fieldsRoute.POST(jsonReq({ label: 'Amount', type: 'number' }), params('obj-a'))
    expect(res.status).toBe(403)
    expect(calls.some((c) => c.op === 'create')).toBe(false)
  })

  it('refuses to delete an object that still has records', async () => {
    session.user = asUser(ADMIN)
    const res = await objectIdRoute.DELETE(get(), params('obj-a'))
    expect(res.status).toBe(409)
    expect(db.objectType.some((o) => o.id === 'obj-a')).toBe(true)
  })

  it('refuses to delete an object that a link field in another object targets', async () => {
    session.user = asUser(ADMIN)
    db.objectType.push({ ...OBJ_A, id: 'obj-c', key: 'co_k', name: 'Companies', restrictToOwner: false })
    db.objectField.push({ ...LINK_A, config: { targetObjectTypeId: 'obj-c' } })
    const res = await objectIdRoute.DELETE(get(), params('obj-c'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('link to Companies')
    expect(db.objectType.some((o) => o.id === 'obj-c')).toBe(true)
  })

  it('deletes a field and strips its key from records in one transaction', async () => {
    session.user = asUser(ADMIN)
    const tx = vi.spyOn(prismaStub, '$transaction')
    const res = await fieldIdRoute.DELETE(get(), params('f-a'))
    expect(res.status).toBe(200)
    expect(tx).toHaveBeenCalledTimes(1)
    expect(tx.mock.calls[0][0]).toHaveLength(2)
    const strip = calls.find((c) => c.op === '$executeRaw')!
    expect(strip.args.sql).toContain('"values" = "values" -')
    expect(strip.args.values).toEqual(['title_x1y2', 'org-a', 'obj-a', 'title_x1y2'])
  })

  it('409s when a config edit removes an option records still use', async () => {
    session.user = asUser(ADMIN)
    db.objectField.push({ ...FIELD_A, id: 'f-s', key: 'stage_k', type: 'status', config: { options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] } })
    results.set('$raw.$queryRaw', [{ n: BigInt(3) }])
    const res = await fieldIdRoute.PATCH(jsonReq({ config: { options: [{ key: 'a', label: 'A' }] } }, 'PATCH'), params('f-s'))
    expect(res.status).toBe(409)
    expect((await res.json()).count).toBe(3)
    expect(calls.find((c) => c.op === '$queryRaw')!.args.values).toContainEqual(['b'])
  })
})

describe('records', () => {
  it('rejects an unknown value key with details', async () => {
    const res = await recordsRoute.POST(jsonReq({ values: { nope: 1 } }), params('obj-a'))
    expect(res.status).toBe(400)
    expect((await res.json()).details).toEqual(['unknown field "nope"'])
  })

  it('400s on malformed filters JSON', async () => {
    const res = await recordsRoute.GET(get('http://test/api/x?filters=%5Bnot'), params('obj-a'))
    expect(res.status).toBe(400)
  })

  it("hides someone else's record from sales when restrictToOwner is on", async () => {
    expect((await recordIdRoute.GET(get(), params('r-other'))).status).toBe(404)
    expect((await recordIdRoute.GET(get(), params('r-mine'))).status).toBe(200)
  })

  it("never lets sales delete someone else's record, even when visible", async () => {
    expect((await recordIdRoute.DELETE(get(), params('r-other'))).status).toBe(404)
    db.objectType[0].restrictToOwner = false
    expect((await recordIdRoute.DELETE(get(), params('r-other'))).status).toBe(404)
    expect(db.objectRecord.some((r) => r.id === 'r-other')).toBe(true)
    expect((await recordIdRoute.DELETE(get(), params('r-mine'))).status).toBe(200)
  })

  it('lets admin delete any record in the org', async () => {
    session.user = asUser(ADMIN)
    expect((await recordIdRoute.DELETE(get(), params('r-other'))).status).toBe(200)
  })

  it('forbids a non-admin from setting ownerId', async () => {
    const create = await recordsRoute.POST(jsonReq({ values: {}, ownerId: 'u-other' }), params('obj-a'))
    expect(create.status).toBe(403)
    const patch = await recordIdRoute.PATCH(jsonReq({ ownerId: 'u-other' }, 'PATCH'), params('r-mine'))
    expect(patch.status).toBe(403)
    expect(calls.some((c) => c.op === 'create' || c.op === '$queryRaw')).toBe(false)
  })

  it('merges a patch in SQL, scoped by org and (for restricted sales) owner', async () => {
    results.set('$raw.$queryRaw', [rec('r-mine', 'org-a', 'obj-a', 'u-sales')])
    const res = await recordIdRoute.PATCH(jsonReq({ values: { title_x1y2: null } }, 'PATCH'), params('r-mine'))
    expect(res.status).toBe(200)
    const upd = calls.find((c) => c.op === '$queryRaw')!
    expect(upd.args.sql).toContain('("values" || ?::jsonb) - ?::text[]')
    expect(upd.args.values).toEqual(['{}', ['title_x1y2'], 'r-mine', 'org-a', 'obj-a', 'u-sales'])
  })

  it('400s when a new link points at a record the user cannot see', async () => {
    db.objectField.push({ ...LINK_A })
    // other org
    expect((await recordsRoute.POST(jsonReq({ values: { rel_k: ['r-b'] } }), params('obj-a'))).status).toBe(400)
    // same org, another owner's record in a restrictToOwner object
    expect((await recordsRoute.POST(jsonReq({ values: { rel_k: ['r-other'] } }), params('obj-a'))).status).toBe(400)
    expect(calls.some((c) => c.op === 'create')).toBe(false)
  })

  it("400s when a person value is another org's user", async () => {
    db.objectField.push({ ...PERSON_A })
    const res = await recordsRoute.POST(jsonReq({ values: { rep_k: 'u-b' } }), params('obj-a'))
    expect(res.status).toBe(400)
    expect(calls.some((c) => c.op === 'create')).toBe(false)
  })

  it('checks only newly added link ids on edit, so a stale existing link does not block it', async () => {
    db.objectField.push({ ...LINK_A })
    db.objectRecord[0].values = { title_x1y2: 'x', rel_k: ['r-gone'] }
    results.set('$raw.$queryRaw', [rec('r-mine', 'org-a', 'obj-a', 'u-sales')])
    const ok = await recordIdRoute.PATCH(jsonReq({ values: { rel_k: ['r-gone', 'r-mine'] } }, 'PATCH'), params('r-mine'))
    expect(ok.status).toBe(200)
    const check = calls.find((c) => c.model === 'objectRecord' && c.op === 'count')!
    expect((check.args.where as { id: { in: string[] } }).id.in).toEqual(['r-mine'])
    const bad = await recordIdRoute.PATCH(jsonReq({ values: { rel_k: ['r-gone', 'r-other'] } }, 'PATCH'), params('r-mine'))
    expect(bad.status).toBe(400)
  })
})
