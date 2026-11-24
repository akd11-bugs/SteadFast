import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, isAdmin } from '@/lib/session'
import { readJsonBody } from '@/lib/http'

export const dynamic = 'force-dynamic'

// Admin-only. The isCore (final) row's key/position are locked — it must
// stay last and keep its key, since lib/leadStage.ts checks that literal key
// to set onboardedAt. Its label is still editable. Intermediate steps can't
// move to or past the final row's position, so "final" always stays final.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const existing = await prisma.onboardingStepDefinition.findFirst({ where: { id, orgId: user.orgId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body

  if (existing.isCore && (body.key !== undefined || body.position !== undefined)) {
    return NextResponse.json({ error: "The final step's key and position are locked" }, { status: 400 })
  }

  if (!existing.isCore && body.position !== undefined) {
    const finalStep = await prisma.onboardingStepDefinition.findFirst({ where: { orgId: user.orgId, isCore: true } })
    if (finalStep && Number(body.position) >= finalStep.position) {
      return NextResponse.json({ error: 'A step cannot move to or past the final step' }, { status: 400 })
    }
  }

  const step = await prisma.onboardingStepDefinition.update({
    where: { id },
    data: {
      ...(body.label !== undefined && { label: String(body.label).trim() }),
      ...(!existing.isCore && body.position !== undefined && { position: Number(body.position) }),
    },
  })
  return NextResponse.json({ step })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const existing = await prisma.onboardingStepDefinition.findFirst({ where: { id, orgId: user.orgId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.isCore) return NextResponse.json({ error: 'The final step cannot be deleted' }, { status: 400 })

  // Leads on this step would lose their place in onboarding. Same guard as stage delete.
  const onStep = await prisma.lead.count({ where: { orgId: user.orgId, onboardingSubStage: existing.key } })
  if (onStep > 0) {
    return NextResponse.json({ error: `${onStep} lead${onStep === 1 ? ' is' : 's are'} still on this step — move them first` }, { status: 409 })
  }

  await prisma.onboardingStepDefinition.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
