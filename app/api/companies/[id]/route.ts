import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, leadScope } from '@/lib/session'
import { readJsonBody } from '@/lib/http'
import { normalizeCompanyName } from '@/lib/company'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const { id } = await params

  const company = await prisma.company.findFirst({
    where: { id, orgId: user.orgId },
    include: {
      people: { orderBy: { name: 'asc' } },
      // Org-scoped company, but its leads follow leadScope: a sales rep sees only their own.
      leads: { where: leadScope(user), orderBy: { updatedAt: 'desc' }, include: { person: true } },
    },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ company })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const { id } = await params
  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body

  const existing = await prisma.company.findFirst({ where: { id, orgId: user.orgId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const name = body.name !== undefined ? String(body.name).trim() : undefined
  if (name !== undefined && !name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })

  try {
    const company = await prisma.company.update({
      where: { id },
      data: {
        ...(name !== undefined && { name, normalizedName: normalizeCompanyName(name) }),
        ...(body.website !== undefined && { website: body.website || null }),
        ...(body.industry !== undefined && { industry: body.industry || null }),
        ...(body.businessType !== undefined && { businessType: body.businessType || null }),
      },
    })
    return NextResponse.json({ company })
  } catch (err) {
    // @@unique([orgId, normalizedName]): renaming onto an existing company.
    if ((err as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'A company with that name already exists' }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const { id } = await params

  const existing = await prisma.company.findFirst({
    where: { id, orgId: user.orgId },
    select: { id: true, _count: { select: { leads: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // A Lead always requires a companyId — deleting a company out from under one
  // would break that invariant, so refuse rather than cascade-delete leads.
  if (existing._count.leads > 0) {
    return NextResponse.json({ error: 'This company still has leads attached — move or delete those first' }, { status: 409 })
  }

  await prisma.person.deleteMany({ where: { companyId: id } })
  await prisma.company.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
