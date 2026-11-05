import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/session'
import { readJsonBody } from '@/lib/http'
import { encrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

export async function POST(req: Request) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body

  const emailFromAddress = String(body.emailFromAddress ?? '').trim()
  const appPassword = String(body.appPassword ?? '').replace(/\s+/g, '')
  if (!EMAIL_PATTERN.test(emailFromAddress)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }
  if (!appPassword) {
    return NextResponse.json({ error: 'App password is required' }, { status: 400 })
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: emailFromAddress, pass: appPassword },
      // Nodemailer's defaults (up to a 10-minute socket timeout) leave the
      // "Saving…" button hanging with no feedback if Gmail is slow to
      // respond or the port is blocked outbound. Fail fast instead.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    })
    await transporter.verify()
  } catch (err) {
    // Logged server-side only (never echoed to the client) — the generic
    // message below covers every failure mode identically (wrong password,
    // 2FA/app-passwords disabled, network block, Google's own abuse
    // heuristics), which makes a real failure indistinguishable from user
    // error without checking these logs.
    console.error('settings/email: transporter.verify() failed', { emailFromAddress, err })
    return NextResponse.json(
      { error: 'Could not sign in with that address and app password — check both and try again' },
      { status: 400 }
    )
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailFromAddress,
      emailAppPasswordEnc: encrypt(appPassword),
      emailConfiguredAt: new Date(),
    },
  })
  return NextResponse.json({ emailFromAddress, configured: true })
}

export async function DELETE() {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  await prisma.user.update({
    where: { id: user.id },
    data: { emailFromAddress: null, emailAppPasswordEnc: null, emailConfiguredAt: null },
  })
  return NextResponse.json({ ok: true })
}
