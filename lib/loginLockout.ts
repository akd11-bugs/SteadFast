import { prisma } from '@/lib/db'
import { neonAuth } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { checkRateLimit, getClientIpFromHeaders } from '@/lib/rateLimit'

// Kept out of lib/auth.ts on purpose — that file is imported by proxy.ts
// (Edge middleware) and must stay free of Prisma, which can't run there.
// This one is only ever called from the server action in app/login/page.tsx
// (a normal Node.js request), never from the Edge.

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000
const MAX_ATTEMPTS_PER_IP = 20
const IP_WINDOW_MS = 15 * 60 * 1000

export type SignInResult =
  | { ok: true }
  | { ok: false; status: 401 | 423 | 429; message: string }

/**
 * Wraps neonAuth.signIn.email() with the same per-account lockout pattern
 * already used for rep PIN logins (lib/repAuth.ts's verifyRepLogin) plus an
 * IP-level rate limit, same family as every other login/signup endpoint
 * (lib/rateLimit.ts's callers). Without this, the admin/sales password login
 * had zero brute-force protection of its own — User.failedLoginAttempts /
 * lockedUntil already existed in the schema but nothing ever wrote to them.
 */
export async function signInWithLockout(email: string, password: string): Promise<SignInResult> {
  const normalizedEmail = email.trim().toLowerCase()

  const ip = await getClientIpFromHeaders()
  const ipLimit = checkRateLimit(`login:${ip}`, MAX_ATTEMPTS_PER_IP, IP_WINDOW_MS)
  if (!ipLimit.allowed) {
    return { ok: false, status: 429, message: 'Too many attempts — try again later' }
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

  const now = new Date()
  if (user?.lockedUntil && user.lockedUntil > now) {
    await logAudit({ action: 'login_locked', targetUserId: user.id, metadata: { email: normalizedEmail } })
    return { ok: false, status: 423, message: 'Too many attempts — try again in 15 minutes' }
  }

  // Count the attempt BEFORE checking it (same reasoning as lib/repAuth.ts):
  // read-then-write let parallel guesses all read 0 and never lock.
  let attempts = 0
  const lock = (id: string) =>
    prisma.user.updateMany({ where: { id, lockedUntil: null }, data: { lockedUntil: new Date(Date.now() + LOCKOUT_MS) } })
  if (user) {
    // An expired lock starts a fresh count. Conditional, so it can't clear a lock set meanwhile.
    if (user.lockedUntil) {
      await prisma.user.updateMany({
        where: { id: user.id, lockedUntil: { lte: now } },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      })
    }
    ;({ failedLoginAttempts: attempts } = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    }))
    if (attempts > MAX_FAILED_ATTEMPTS) {
      await lock(user.id) // self-heals if the attempt that hit the limit never set the lock
      await logAudit({ action: 'login_locked', targetUserId: user.id, metadata: { email: normalizedEmail, attempts } })
      return { ok: false, status: 423, message: 'Too many attempts — try again in 15 minutes' }
    }
  }

  const { error } = await neonAuth.signIn.email({ email: normalizedEmail, password })

  if (error) {
    if (user) {
      const lockingNow = attempts >= MAX_FAILED_ATTEMPTS
      if (lockingNow) await lock(user.id)
      await logAudit({
        action: lockingNow ? 'login_locked' : 'login_failed',
        targetUserId: user.id,
        metadata: { email: normalizedEmail, attempts },
      })
      if (lockingNow) return { ok: false, status: 423, message: 'Too many attempts — try again in 15 minutes' }
    }
    return { ok: false, status: 401, message: 'Invalid email or password' }
  }

  if (user) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } })
    await logAudit({ action: 'login_success', actorUserId: user.id, targetUserId: user.id, metadata: { email: normalizedEmail } })
  }

  return { ok: true }
}
