import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, isAdmin } from '@/lib/session'
import { readJsonBody } from '@/lib/http'
import { encrypt } from '@/lib/crypto'
import { createMailboxTransporter } from '@/lib/email'

export const dynamic = 'force-dynamic'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET() {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const config = await prisma.orgEmailConfig.findUnique({
    where: { orgId: user.orgId },
    select: { smtpHost: true, smtpPort: true, smtpSecure: true, smtpUser: true, fromAddress: true, fromName: true, configuredAt: true },
  })
  return NextResponse.json({ config })
}

export async function POST(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body

  const smtpHost = String(body.smtpHost ?? '').trim()
  const smtpPort = Number(body.smtpPort)
  const smtpSecure = body.smtpSecure !== false
  const smtpUser = String(body.smtpUser ?? '').trim()
  // Google displays a Gmail app password with spaces for readability
  // (e.g. "abcd efgh ijkl mnop") — the real password is the 16 characters
  // with no spaces. Pasted verbatim, those spaces make a genuinely correct
  // password fail Gmail's SMTP auth. Scoped to Gmail hosts only (including
  // a Google Workspace business address, which still routes through
  // smtp.gmail.com) since some other provider's real password could in
  // principle contain a space.
  const isGmailHost = /gmail/i.test(smtpHost)
  const rawSmtpPass = String(body.smtpPass ?? '')
  const smtpPass = isGmailHost ? rawSmtpPass.replace(/\s+/g, '') : rawSmtpPass
  const fromAddress = String(body.fromAddress ?? '').trim()
  const fromName = body.fromName ? String(body.fromName).trim() : null

  if (!smtpHost || !smtpPort || !smtpUser || !fromAddress) {
    return NextResponse.json({ error: 'smtpHost, smtpPort, smtpUser, and fromAddress are required' }, { status: 400 })
  }
  if (!EMAIL_PATTERN.test(fromAddress)) {
    return NextResponse.json({ error: 'fromAddress must be a valid email address' }, { status: 400 })
  }

  // A password is only required the first time — re-saving host/port/from
  // details without re-entering the password keeps the existing one.
  const existing = await prisma.orgEmailConfig.findUnique({ where: { orgId: user.orgId } })
  if (!smtpPass && !existing) {
    return NextResponse.json({ error: 'smtpPass is required' }, { status: 400 })
  }

  try {
    // Verifying with no password (re-save path) would fail even though the
    // stored credential is fine — only re-verify when a new password came in.
    if (smtpPass) {
      const transporter = createMailboxTransporter({ host: smtpHost, port: smtpPort, secure: smtpSecure, user: smtpUser, pass: smtpPass })
      await transporter.verify()
    }
  } catch {
    return NextResponse.json(
      { error: 'Could not sign in with that SMTP host/user/password — check them and try again' },
      { status: 400 },
    )
  }

  const config = await prisma.orgEmailConfig.upsert({
    where: { orgId: user.orgId },
    create: {
      orgId: user.orgId,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPassEnc: encrypt(smtpPass),
      fromAddress,
      fromName,
      configuredByUserId: user.id,
    },
    update: {
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      ...(smtpPass ? { smtpPassEnc: encrypt(smtpPass) } : {}),
      fromAddress,
      fromName,
      configuredByUserId: user.id,
    },
    select: { smtpHost: true, smtpPort: true, smtpSecure: true, smtpUser: true, fromAddress: true, fromName: true, configuredAt: true },
  })
  return NextResponse.json({ config })
}

export async function DELETE() {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.orgEmailConfig.deleteMany({ where: { orgId: user.orgId } })
  return NextResponse.json({ ok: true })
}
