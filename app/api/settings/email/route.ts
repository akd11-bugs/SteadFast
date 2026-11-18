import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

// Connecting is now a full OAuth consent redirect — see
// app/api/settings/email/oauth/start and .../oauth/callback — rather than
// a POST of an address+app-password pair. Render's free tier blocks
// outbound SMTP entirely (confirmed via live ETIMEDOUT connection
// failures on both ports 465 and 587), so the Gmail API over HTTPS
// replaces SMTP here; GET/DELETE keep their previous shape.

export async function GET() {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { emailFromAddress: true, emailConfiguredAt: true },
  })
  return NextResponse.json({
    emailFromAddress: record?.emailFromAddress ?? null,
    configured: !!record?.emailConfiguredAt,
  })
}

export async function DELETE() {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  await prisma.user.update({
    where: { id: user.id },
    data: { emailFromAddress: null, gmailRefreshTokenEnc: null, emailConfiguredAt: null },
  })
  return NextResponse.json({ ok: true })
}
