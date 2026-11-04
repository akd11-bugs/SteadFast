import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireApiUser, isAdmin } from '@/lib/session'
import { readJsonBody } from '@/lib/http'
import { getSheetRows } from '@/lib/googleSheets'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

// Legitimate use is "an admin sets this up once, rarely revisits it" — this
// cap exists only to kill sheetId enumeration: the 409 on a sheetId another
// org already claimed is itself a (low-severity, but real) information leak
// ("this sheet exists and belongs to someone"), so a malicious or compromised
// admin account shouldn't be able to probe many sheetIds quickly to map them.
const MAX_ATTEMPTS_PER_HOUR = 20
const WINDOW_MS = 60 * 60 * 1000

// Every org shares this one deployment-wide service account (see
// lib/googleSheets.ts) — an org admin's whole setup is sharing their sheet
// with this address, not creating their own GCP project/credentials.
function sharedServiceAccountEmail(): string | null {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null
}

export async function GET() {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const connector = await prisma.orgSheetConnector.findUnique({
    where: { orgId: user.orgId },
    select: { sheetId: true, sheetRange: true, defaultOwnerUserId: true, enabled: true, lastSyncedAt: true, configuredAt: true },
  })
  return NextResponse.json({ connector, serviceAccountEmail: sharedServiceAccountEmail() })
}

export async function POST(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rateLimit = checkRateLimit(`org-sheet-connector:${user.id}`, MAX_ATTEMPTS_PER_HOUR, WINDOW_MS)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const serviceAccountEmail = sharedServiceAccountEmail()
  if (!serviceAccountEmail) {
    return NextResponse.json(
      { error: 'Server misconfigured: GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are not set' },
      { status: 500 },
    )
  }

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body

  const sheetId = String(body.sheetId ?? '').trim()
  const sheetRange = String(body.sheetRange ?? 'Sheet1').trim() || 'Sheet1'
  const defaultOwnerUserId = String(body.defaultOwnerUserId ?? '').trim()

  if (!sheetId || !defaultOwnerUserId) {
    return NextResponse.json({ error: 'sheetId and defaultOwnerUserId are required' }, { status: 400 })
  }

  const owner = await prisma.user.findUnique({ where: { id: defaultOwnerUserId }, select: { orgId: true } })
  if (!owner || owner.orgId !== user.orgId) {
    return NextResponse.json({ error: 'defaultOwnerUserId must be a user in your org' }, { status: 400 })
  }

  // Verify the shared service account can actually read this sheet before
  // saving — the most common failure here is the admin forgetting to share
  // the sheet with it. Same "fail fast with a clear message" pattern as the
  // email settings card's transporter.verify(). The underlying error
  // (getSheetRows embeds the raw HTTP response body in its message, which
  // for a bad sheet ID is literally Google's full "Page Not Found" HTML
  // document) is logged server-side only — never echoed to the client.
  try {
    await getSheetRows(sheetId, sheetRange)
  } catch (err) {
    console.error('org-sheet-connector: could not read sheet', { orgId: user.orgId, sheetId, err })
    return NextResponse.json(
      { error: `Could not read that sheet. Check the sheet ID and that it's shared with ${serviceAccountEmail}.` },
      { status: 400 },
    )
  }

  try {
    const connector = await prisma.orgSheetConnector.upsert({
      where: { orgId: user.orgId },
      create: { orgId: user.orgId, sheetId, sheetRange, defaultOwnerUserId, configuredByUserId: user.id },
      update: { sheetId, sheetRange, defaultOwnerUserId, configuredByUserId: user.id },
      select: { sheetId: true, sheetRange: true, defaultOwnerUserId: true, enabled: true, lastSyncedAt: true, configuredAt: true },
    })
    return NextResponse.json({ connector, serviceAccountEmail })
  } catch (err) {
    // sheetId is globally unique (prisma/schema.prisma) so a second org
    // cannot bind the same sheet — being able to read it (checked above)
    // doesn't mean they're allowed to claim it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'That sheet is already connected to a different organization.' }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE() {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.orgSheetConnector.deleteMany({ where: { orgId: user.orgId } })
  return NextResponse.json({ ok: true })
}
