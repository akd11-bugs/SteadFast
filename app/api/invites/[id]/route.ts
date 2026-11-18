import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, isAdmin } from '@/lib/session'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const existing = await prisma.invite.findFirst({ where: { id, orgId: { in: user.visibleOrgIds } } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending invites can be revoked' }, { status: 400 })
  }

  // Conditional on still-pending: a redeem that lands between the read above
  // and this write must not be overwritten to 'revoked'.
  const revoked = await prisma.invite.updateMany({ where: { id, status: 'pending' }, data: { status: 'revoked' } })
  if (revoked.count === 0) {
    return NextResponse.json({ error: 'Only pending invites can be revoked' }, { status: 400 })
  }
  await logAudit({ action: 'invite_revoked', actorUserId: user.id, targetInviteId: id })

  return NextResponse.json({ invite: { ...existing, status: 'revoked' } })
}
