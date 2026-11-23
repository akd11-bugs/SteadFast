import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { readJsonBody } from '@/lib/http'
import { isFieldType, readConfig, validateConfig, type FieldConfig } from '@/lib/records/fieldTypes'
import { canEditSchema } from '@/lib/records/scope'
import { badRequest, engineUser, fieldOut, forbidden, notFound } from '@/lib/records/api'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
const OPTION_TYPES = new Set(['status', 'select', 'multi_select'])

// type and key are immutable: records store values under the key, shaped by the type.
export async function PATCH(req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  if (!canEditSchema(user)) return forbidden()
  const field = await prisma.objectField.findFirst({ where: { id: (await params).id, orgId: user.orgId } })
  if (!field) return notFound()

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  if (body?.type !== undefined || body?.key !== undefined) return badRequest('type and key cannot be changed')

  const data: { label?: string; config?: Prisma.InputJsonValue; required?: boolean; position?: number } = {}
  if (body.label !== undefined) {
    const label = typeof body.label === 'string' ? body.label.trim() : ''
    if (!label || label.length > 80) return badRequest('label must be 1-80 characters')
    data.label = label
  }
  if (body.required !== undefined) {
    if (typeof body.required !== 'boolean') return badRequest('required must be true or false')
    data.required = body.required
  }
  if (body.position !== undefined) {
    if (!Number.isInteger(body.position) || body.position < 0) return badRequest('position must be a non-negative integer')
    data.position = body.position
  }
  if (body.config !== undefined) {
    if (!isFieldType(field.type)) return badRequest('field has an unknown type')
    const checked = validateConfig(field.type, body.config)
    if ('error' in checked) return badRequest(checked.error)
    if (field.type === 'link' && checked.config.targetObjectTypeId !== readConfig(field.config).targetObjectTypeId) {
      return badRequest('a link field cannot change its target object')
    }
    if (OPTION_TYPES.has(field.type)) {
      const inUse = await removedOptionsInUse(field, checked.config)
      if (inUse > 0) {
        return NextResponse.json(
          { error: `${inUse} record(s) still use an option you removed; change them first`, count: inUse },
          { status: 409 },
        )
      }
    }
    data.config = checked.config as Prisma.InputJsonValue
  }

  const updated = await prisma.objectField.update({ where: { id: field.id }, data })
  return NextResponse.json({ field: fieldOut(updated) })
}

// Counts records holding an option key the new config drops — removing it
// would leave values no option can display or validate.
async function removedOptionsInUse(
  field: { key: string; type: string; config: unknown; orgId: string; objectTypeId: string },
  next: FieldConfig,
): Promise<number> {
  const kept = new Set((next.options ?? []).map((o) => o.key))
  const removed = (readConfig(field.config).options ?? []).map((o) => o.key).filter((k) => !kept.has(k))
  if (removed.length === 0) return 0
  const match =
    field.type === 'multi_select'
      ? Prisma.sql`jsonb_typeof("values" -> ${field.key}) = 'array' AND ("values" -> ${field.key}) ?| ${removed}::text[]`
      : Prisma.sql`("values" ->> ${field.key}) = ANY(${removed}::text[])`
  const rows = await prisma.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "ObjectRecord"
      WHERE "orgId" = ${field.orgId} AND "objectTypeId" = ${field.objectTypeId} AND ${match}`,
  )
  return Number(rows[0]?.n ?? 0)
}

// Deletes the field and strips its key from every record of that object in
// one transaction, so no record keeps a value no field describes.
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  if (!canEditSchema(user)) return forbidden()
  const field = await prisma.objectField.findFirst({ where: { id: (await params).id, orgId: user.orgId } })
  if (!field) return notFound()

  await prisma.$transaction([
    prisma.objectField.delete({ where: { id: field.id } }),
    prisma.$executeRaw(Prisma.sql`UPDATE "ObjectRecord" SET "values" = "values" - ${field.key}::text
      WHERE "orgId" = ${field.orgId} AND "objectTypeId" = ${field.objectTypeId} AND "values" ? ${field.key}`),
  ])
  return NextResponse.json({ ok: true })
}
