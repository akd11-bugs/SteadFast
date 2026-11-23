import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { readJsonBody } from '@/lib/http'
import { validateValues } from '@/lib/records/fieldTypes'
import { checkReferences, findObjectType, listFields } from '@/lib/records/scope'
import { queryRecords, type Filter } from '@/lib/records/query'
import { badRequest, engineUser, forbidden, isPrivileged, notFound, toRecord } from '@/lib/records/api'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  const object = await findObjectType(user, (await params).id)
  if (!object) return notFound()

  const sp = new URL(req.url).searchParams
  let filters: Filter[] = []
  const rawFilters = sp.get('filters')
  if (rawFilters) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawFilters)
    } catch {
      return badRequest('filters must be valid JSON')
    }
    if (!Array.isArray(parsed) || !parsed.every((f) => f && typeof f === 'object' && typeof f.field === 'string')) {
      return badRequest('filters must be a list of {field, op, value?}')
    }
    filters = parsed as Filter[]
  }
  const sortField = sp.get('sort')
  const fields = await listFields(object.id, object.orgId)
  const result = await queryRecords(user, object, fields, {
    filters,
    sort: sortField ? { field: sortField, dir: sp.get('dir') === 'asc' ? 'asc' : 'desc' } : undefined,
    search: sp.get('q') ?? undefined,
    page: sp.has('page') ? Number(sp.get('page')) || 1 : undefined,
    pageSize: sp.has('pageSize') ? Number(sp.get('pageSize')) || undefined : undefined,
  })
  if ('error' in result) return badRequest(result.error ?? 'bad query')
  return NextResponse.json(result)
}

export async function POST(req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  const object = await findObjectType(user, (await params).id)
  if (!object) return notFound()

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  const fields = await listFields(object.id, object.orgId)
  const checked = validateValues(fields, body?.values, { partial: false })
  if ('errors' in checked) return badRequest('invalid values', checked.errors)
  const refErrors = await checkReferences(user, fields, checked.values)
  if (refErrors.length) return badRequest('invalid values', refErrors)

  let ownerId: string = user.id
  if (body.ownerId !== undefined && body.ownerId !== user.id) {
    if (!isPrivileged(user)) return forbidden()
    if (typeof body.ownerId !== 'string') return badRequest('ownerId must be a user id')
    const n = await prisma.user.count({ where: { id: body.ownerId, orgId: user.orgId, isActive: true } })
    if (n === 0) return badRequest('owner not found')
    ownerId = body.ownerId
  }

  // null means "empty" — don't store it on create.
  const values = Object.fromEntries(Object.entries(checked.values).filter(([, v]) => v !== null))
  const record = await prisma.objectRecord.create({
    data: {
      orgId: object.orgId,
      objectTypeId: object.id,
      values: values as Prisma.InputJsonObject,
      ownerId,
      createdById: user.id,
    },
  })
  return NextResponse.json({ record: toRecord(record) })
}
