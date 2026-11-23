import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { readJsonBody } from '@/lib/http'
import type { SessionUser } from '@/lib/session'
import { validateValues, type Value } from '@/lib/records/fieldTypes'
import { checkReferences, listFields, recordScope } from '@/lib/records/scope'
import { badRequest, engineUser, fieldOut, forbidden, isPrivileged, notFound, toRecord } from '@/lib/records/api'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
const OBJECT_SELECT = { id: true, orgId: true, key: true, name: true, icon: true, position: true, restrictToOwner: true } as const

// The record's object type, found inside the user's org. Its restrictToOwner
// decides recordScope, so it must be known before the scoped record lookup.
async function objectTypeOf(user: SessionUser, id: string) {
  const hit = await prisma.objectRecord.findFirst({
    where: { id, orgId: { in: user.visibleOrgIds } },
    select: { objectType: { select: OBJECT_SELECT } },
  })
  return hit?.objectType ?? null
}

export async function GET(_req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  const { id } = await params
  const objectType = await objectTypeOf(user, id)
  if (!objectType) return notFound()
  const record = await prisma.objectRecord.findFirst({ where: { id, ...recordScope(user, objectType) } })
  if (!record) return notFound()
  const fields = await listFields(objectType.id, objectType.orgId)
  const { orgId: _orgId, ...objectOut } = objectType
  return NextResponse.json({ record: toRecord(record), objectType: objectOut, fields: fields.map(fieldOut) })
}

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  const { id } = await params
  const objectType = await objectTypeOf(user, id)
  if (!objectType) return notFound()
  const scope = recordScope(user, objectType)
  const current = await prisma.objectRecord.findFirst({ where: { id, ...scope }, select: { ownerId: true, values: true } })
  if (!current) return notFound()

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  if (body?.values === undefined && body?.ownerId === undefined) return badRequest('nothing to update')

  let patch: { [key: string]: Value } = {}
  if (body.values !== undefined) {
    const fields = await listFields(objectType.id, objectType.orgId)
    const checked = validateValues(fields, body.values, { partial: true })
    if ('errors' in checked) return badRequest('invalid values', checked.errors)
    // Only newly added link ids are checked: an id already on the record may
    // since be deleted or hidden from this user and must not block the edit.
    const old = (current.values ?? {}) as { [key: string]: unknown }
    const toCheck = { ...checked.values }
    for (const f of fields) {
      const v = toCheck[f.key]
      if (f.type !== 'link' || !Array.isArray(v)) continue
      const had = new Set(Array.isArray(old[f.key]) ? (old[f.key] as string[]) : [])
      const added = v.filter((x) => !had.has(x))
      if (added.length) toCheck[f.key] = added
      else delete toCheck[f.key]
    }
    const refErrors = await checkReferences(user, fields, toCheck)
    if (refErrors.length) return badRequest('invalid values', refErrors)
    patch = checked.values
  }

  let newOwner: string | undefined
  if (body.ownerId !== undefined && body.ownerId !== current.ownerId) {
    if (!isPrivileged(user)) return forbidden()
    if (typeof body.ownerId !== 'string') return badRequest('ownerId must be a user id')
    const n = await prisma.user.count({ where: { id: body.ownerId, orgId: user.orgId, isActive: true } })
    if (n === 0) return badRequest('owner not found')
    newOwner = body.ownerId
  }

  // Merge in SQL, not read-modify-write, so two people editing different
  // fields at once both keep their change. null in the patch clears a key.
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null))
  const cleared = Object.keys(patch).filter((k) => patch[k] === null)
  const rows = await prisma.$queryRaw<
    { id: string; values: Prisma.JsonValue; ownerId: string | null; createdById: string; createdAt: Date; updatedAt: Date }[]
  >(Prisma.sql`UPDATE "ObjectRecord"
    SET "values" = ("values" || ${JSON.stringify(set)}::jsonb) - ${cleared}::text[],
        "updatedAt" = NOW()${newOwner !== undefined ? Prisma.sql`, "ownerId" = ${newOwner}` : Prisma.empty}
    WHERE "id" = ${id} AND "orgId" = ${objectType.orgId} AND "objectTypeId" = ${objectType.id}
      ${'ownerId' in scope ? Prisma.sql`AND "ownerId" = ${scope.ownerId}` : Prisma.empty}
    RETURNING "id", "values", "ownerId", "createdById", "createdAt", "updatedAt"`)
  if (!rows[0]) return notFound()
  return NextResponse.json({ record: toRecord(rows[0]) })
}

// Admin/operations may delete any record they can see; everyone else only
// their own. Anything else is 404 — don't confirm the record exists.
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  const { id } = await params
  const objectType = await objectTypeOf(user, id)
  if (!objectType) return notFound()
  const { count } = await prisma.objectRecord.deleteMany({
    where: { id, ...recordScope(user, objectType), ...(isPrivileged(user) ? {} : { ownerId: user.id }) },
  })
  if (count === 0) return notFound()
  return NextResponse.json({ ok: true })
}
