import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { readJsonBody } from '@/lib/http'
import { makeKey } from '@/lib/records/fieldTypes'
import { canEditSchema } from '@/lib/records/scope'
import { badRequest, engineUser, forbidden, randomSuffix } from '@/lib/records/api'

export const dynamic = 'force-dynamic'

const OBJECT_SELECT = { id: true, key: true, name: true, icon: true, position: true, restrictToOwner: true } as const

export async function GET() {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  const objects = await prisma.objectType.findMany({
    where: { orgId: user.orgId },
    orderBy: { position: 'asc' },
    select: OBJECT_SELECT,
  })
  return NextResponse.json({ objects })
}

export async function POST(req: Request) {
  const user = await engineUser()
  if (user instanceof NextResponse) return user
  if (!canEditSchema(user)) return forbidden()

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 60) return badRequest('name must be 1-60 characters')
  if (body.icon !== undefined && body.icon !== null && (typeof body.icon !== 'string' || body.icon.length > 40)) {
    return badRequest('icon must be a short string')
  }

  const last = await prisma.objectType.findFirst({
    where: { orgId: user.orgId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const object = await prisma.objectType.create({
    data: {
      orgId: user.orgId,
      key: makeKey(name, randomSuffix()),
      name,
      icon: body.icon ?? null,
      restrictToOwner: body.restrictToOwner === true,
      position: (last?.position ?? -1) + 1,
    },
    select: OBJECT_SELECT,
  })
  return NextResponse.json({ object })
}
