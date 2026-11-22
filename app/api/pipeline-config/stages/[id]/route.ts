import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, isAdmin } from '@/lib/session'
import { readJsonBody } from '@/lib/http'

export const dynamic = 'force-dynamic'

// Admin-only. isCore rows (the 5 built-in stages) can only have their
// label/description/color edited — key and position are locked because
// lib/leadStage.ts/lib/alerts.ts/lib/reportsData.ts branch on the literal
// key, and reordering core stages would break lib/types.ts's separate
// PIPELINE_CHECKPOINTS index math. Custom stages are fully editable.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const existing = await prisma.stageDefinition.findFirst({ where: { id, orgId: user.orgId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body

  if (existing.isCore && (body.key !== undefined || body.position !== undefined)) {
    return NextResponse.json({ error: "This stage's key and position are locked" }, { status: 400 })
  }

  const stage = await prisma.stageDefinition.update({
    where: { id },
    data: {
      ...(body.label !== undefined && { label: String(body.label).trim() }),
      ...(body.description !== undefined && { description: body.description ? String(body.description) : null }),
      ...(body.color !== undefined && { color: body.color ? String(body.color) : null }),
      ...(!existing.isCore && body.position !== undefined && { position: Number(body.position) }),
    },
  })
  return NextResponse.json({ stage })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const existing = await prisma.stageDefinition.findFirst({ where: { id, orgId: user.orgId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.isCore) return NextResponse.json({ error: 'Core stages cannot be deleted' }, { status: 400 })

  // Leads still in this stage would drop off every board column. Make the admin move them first.
  const inStage = await prisma.lead.count({ where: { orgId: user.orgId, stage: existing.key } })
  if (inStage > 0) {
    return NextResponse.json({ error: `${inStage} lead${inStage === 1 ? ' is' : 's are'} still in this stage — move them first` }, { status: 409 })
  }

  await prisma.stageDefinition.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
