import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { readJsonBody } from '@/lib/http'
import { canEditSchema, findObjectType } from '@/lib/records/scope'
import { badRequest, engineUser, forbidden, notFound } from '@/lib/records/api'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
const OBJECT_SELECT = { id: true, key: true, name: true, icon: true, position: true, restrictToOwner: true } as const

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  if (!canEditSchema(user)) return forbidden()
  const existing = await findObjectType(user, (await params).id)
  if (!existing) return notFound()

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  const data: { name?: string; icon?: string | null; restrictToOwner?: boolean; position?: number } = {}
  if (body?.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 60) return badRequest('name must be 1-60 characters')
    data.name = name
  }
  if (body?.icon !== undefined) {
    if (body.icon !== null && (typeof body.icon !== 'string' || body.icon.length > 40)) return badRequest('icon must be a short string')
    data.icon = body.icon
  }
  if (body?.restrictToOwner !== undefined) {
    if (typeof body.restrictToOwner !== 'boolean') return badRequest('restrictToOwner must be true or false')
    data.restrictToOwner = body.restrictToOwner
  }
  if (body?.position !== undefined) {
    if (!Number.isInteger(body.position) || body.position < 0) return badRequest('position must be a non-negative integer')
    data.position = body.position
  }

  const object = await prisma.objectType.update({ where: { id: existing.id }, data, select: OBJECT_SELECT })
  return NextResponse.json({ object })
}

// Never deletes data silently: an object with records must be emptied first.
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  if (!canEditSchema(user)) return forbidden()
  const existing = await findObjectType(user, (await params).id)
  if (!existing) return notFound()

  const n = await prisma.objectRecord.count({ where: { orgId: existing.orgId, objectTypeId: existing.id } })
  if (n > 0) return NextResponse.json({ error: `${existing.name} still has ${n} record(s); delete them first` }, { status: 409 })
  const links = await prisma.objectField.count({
    // Its own self-links are cascade-deleted with it, so only other objects' fields block.
    where: {
      orgId: existing.orgId,
      type: 'link',
      objectTypeId: { not: existing.id },
      config: { path: ['targetObjectTypeId'], equals: existing.id },
    },
  })
  if (links > 0) {
    return NextResponse.json({ error: `Fields in other objects link to ${existing.name}; delete those fields first` }, { status: 409 })
  }
  // `records: { none: {} }` re-checks inside the DELETE, so a record created
  // since the count blocks the delete instead of being cascaded away.
  const { count } = await prisma.objectType.deleteMany({
    where: { id: existing.id, orgId: existing.orgId, records: { none: {} } },
  })
  if (count === 0) return NextResponse.json({ error: `${existing.name} has records; delete them first` }, { status: 409 })
  return NextResponse.json({ ok: true })
}
