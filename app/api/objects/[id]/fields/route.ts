import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { readJsonBody } from '@/lib/http'
import { isFieldType, makeKey, validateConfig } from '@/lib/records/fieldTypes'
import { canEditSchema, findObjectType, listFields } from '@/lib/records/scope'
import { badRequest, engineUser, fieldOut, forbidden, notFound, randomSuffix } from '@/lib/records/api'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
const MAX_FIELDS = 200

export async function GET(_req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  const object = await findObjectType(user, (await params).id)
  if (!object) return notFound()
  const fields = await listFields(object.id, object.orgId)
  return NextResponse.json({ fields: fields.map(fieldOut) })
}

export async function POST(req: Request, { params }: Ctx) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  if (!canEditSchema(user)) return forbidden()
  const object = await findObjectType(user, (await params).id)
  if (!object) return notFound()

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  const label = typeof body?.label === 'string' ? body.label.trim() : ''
  if (!label || label.length > 80) return badRequest('label must be 1-80 characters')
  if (!isFieldType(body.type)) return badRequest('unknown field type')
  const checked = validateConfig(body.type, body.config)
  if ('error' in checked) return badRequest(checked.error)
  if (body.type === 'link') {
    const target = await prisma.objectType.findFirst({
      where: { id: checked.config.targetObjectTypeId, orgId: object.orgId },
      select: { id: true },
    })
    if (!target) return badRequest('link target object not found')
  }

  const existing = await prisma.objectField.findMany({
    where: { objectTypeId: object.id, orgId: object.orgId },
    select: { position: true },
  })
  if (existing.length >= MAX_FIELDS) return badRequest(`at most ${MAX_FIELDS} fields per object`)

  const field = await prisma.objectField.create({
    data: {
      orgId: object.orgId,
      objectTypeId: object.id,
      key: makeKey(label, randomSuffix()),
      label,
      type: body.type,
      config: checked.config as Prisma.InputJsonValue,
      required: body.required === true,
      position: existing.reduce((m, f) => Math.max(m, f.position), -1) + 1,
    },
  })
  return NextResponse.json({ field: fieldOut(field) })
}
