import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { readJsonBody } from '@/lib/http'
import { isValidEmail } from '@/lib/types'
import { checkRateLimit, getClientIp } from '@/lib/rateLimit'
import { generateRandomToken } from '@/lib/crypto'
import { EMAIL_AUTH_ENABLED } from '@/lib/authFlags'

export const dynamic = 'force-dynamic'

const TOKEN_TTL_MS = 30 * 60 * 1000
// Blocks re-sending to the same address faster than this — the actual abuse
// this stops is one person (or a script) flooding someone else's inbox with
// signup links, not a legitimate user who mistyped and wants to retry.
const RESEND_COOLDOWN_MS = 2 * 60 * 1000

// Public route — no requireApiUser(). Anyone can ask for a signup link;
// they still land as a 'pending' account with no access until an admin
// approves them from Organisation. Excluded from proxy.ts's auth wall.
export async function POST(req: Request) {
  // Off until outbound email works (lib/authFlags.ts). Refused before any
  // token is written, so nothing is left behind for a link that can't go out.
  if (!EMAIL_AUTH_ENABLED) {
    return NextResponse.json({ error: 'Email sign-up is unavailable — sign up with Google instead' }, { status: 503 })
  }
  const ip = getClientIp(req)
  const rateLimit = checkRateLimit(`signup-request:${ip}`, 5, 60 * 60 * 1000)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts — try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  const email = String(body.email ?? '').trim().toLowerCase()

  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    return NextResponse.json({ error: 'That email is already registered — log in instead' }, { status: 409 })
  }

  const recentToken = await prisma.signupToken.findFirst({
    where: { email, createdAt: { gte: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
    orderBy: { createdAt: 'desc' },
  })
  if (recentToken) {
    return NextResponse.json({ error: 'A signup link was already sent — check your inbox, or wait a couple of minutes to request another' }, { status: 429 })
  }

  const token = generateRandomToken(32)
  await prisma.signupToken.create({
    data: { email, token, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  })

  const origin = new URL(req.url).origin
  const link = `${origin}/signup/complete?token=${token}`

  try {
    await sendEmail({
      to: email,
      subject: 'Finish setting up your Steadfast account',
      body: `Click the link below to set your name and password and finish creating your account:\n\n${link}\n\nThis link expires in 30 minutes. If you didn't request this, you can ignore this email.`,
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not send the email — please try again shortly or contact an admin' },
      { status: 502 }
    )
  }

  return NextResponse.json({ ok: true })
}
