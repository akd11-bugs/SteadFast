import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { readJsonBody } from '@/lib/http'
import { createOrganization, seedSampleLeads } from '@/lib/org'
import { signUpNeonAuthAccount } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Public route — no requireApiUser(). Finishes account creation for a
// signup link requested via /api/signup/request. Excluded from proxy.ts's
// auth wall. Always creates a brand-new, fully isolated org — this is how
// a company's founding admin gets onboarded; everyone else at that company
// joins via that admin's invite (app/api/invites/redeem), not this route.
export async function POST(req: Request) {
  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  const token = String(body.token ?? '').trim()
  const name = String(body.name ?? '').trim()
  const companyName = String(body.companyName ?? '').trim()
  const password = String(body.password ?? '')

  if (!token || !name || !companyName || !password) {
    return NextResponse.json({ error: 'token, name, companyName, and password are required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  // Claims the token atomically (closes the race where two requests complete
  // the same link at once) and reserves the email. The actual account —
  // the Neon Auth credential identity, then our own org + User row — is
  // created below, outside this transaction, since signUp is a network call.
  let signupEmail: string
  try {
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.signupToken.updateMany({
        where: { token, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      })
      if (claim.count !== 1) return null

      const signupToken = await tx.signupToken.findUnique({ where: { token } })
      if (!signupToken) return null

      const existingUser = await tx.user.findUnique({ where: { email: signupToken.email } })
      if (existingUser) return 'already-registered' as const

      return signupToken.email
    })

    if (claimed === null) {
      return NextResponse.json({ error: 'This link is invalid or has expired' }, { status: 410 })
    }
    if (claimed === 'already-registered') {
      return NextResponse.json({ error: 'That email is already registered — log in instead' }, { status: 409 })
    }
    signupEmail = claimed
  } catch {
    return NextResponse.json({ error: 'This link is invalid or has expired' }, { status: 410 })
  }

  // Creates the actual credential identity in Neon Auth — /login's
  // email/password sign-in checks against this, not our own passwordHash
  // column (kept null from here on; Neon Auth owns password verification).
  const signUp = await signUpNeonAuthAccount({ email: signupEmail, password, name })
  if (!signUp.ok) {
    // The token was already atomically claimed above, but no account got
    // created — release it so the same link can be retried instead of
    // being silently burned.
    await prisma.signupToken.update({ where: { token }, data: { usedAt: null } })
    return NextResponse.json({ error: signUp.message }, { status: 409 })
  }

  const org = await createOrganization(companyName)
  // The token-claim transaction above already serializes two requests for
  // the SAME signup link, but a different path (an invite redeemed, or a
  // domain auto-join) could in principle create a User for this email in
  // the gap between that transaction and this insert — the unique
  // constraint on email is what actually closes it. The org row stays
  // orphaned in that case (acceptable: empty, no seedSampleLeads yet), but
  // the request must not 500.
  let user
  try {
    user = await prisma.user.create({
      data: { orgId: org.id, name, email: signupEmail, passwordHash: null, role: 'admin', isActive: true },
    })
  } catch (err) {
    const isDuplicateEmail = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
    if (!isDuplicateEmail) throw err
    return NextResponse.json({ error: 'That email is already registered — log in instead' }, { status: 409 })
  }
  await seedSampleLeads(org.id)

  await logAudit({
    action: 'org_created',
    actorUserId: user.id,
    targetUserId: user.id,
    metadata: { orgId: org.id, companyName },
  })

  return NextResponse.json({ ok: true })
}
