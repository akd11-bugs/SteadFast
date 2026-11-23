import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

export type RepLoginResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 423; error: string }

// Separate lockout counters from the real dashboard password (User.pinHash /
// pinFailedAttempts / pinLockedUntil) — a rep locked out of the PIN form
// shouldn't lock their dashboard login, or vice versa.
//
// Identified by (orgId, name). Field reps have no email, so the org cannot be
// derived from the credential itself — it comes from the per-org login URL
// (/rep/<slug>) and is passed in here.
//
// This used to search User.name across EVERY org and accept the login only
// when exactly one match existed anywhere. Two tenants each employing a
// "Priya" therefore locked BOTH out, with a generic error neither admin
// could diagnose: a cross-tenant outage one customer could inflict on
// another. Scoping by orgId removes the ambiguity entirely, and
// @@unique([orgId, name]) now makes a duplicate within one org impossible.
export async function verifyRepLogin(orgId: string, name: string, pin: string): Promise<RepLoginResult> {
  const normalizedName = name.trim()
  const user = await prisma.user.findFirst({
    where: { orgId, name: { equals: normalizedName, mode: 'insensitive' } },
  })

  if (!user || !user.isActive || !user.pinHash) {
    await logAudit({ action: 'rep_login_failed', metadata: { orgId, name: normalizedName, reason: 'no_pin_set' } })
    return { ok: false, status: 401, error: 'Invalid name or PIN' }
  }

  const now = new Date()
  if (user.pinLockedUntil && user.pinLockedUntil > now) {
    await logAudit({ action: 'rep_login_locked', targetUserId: user.id, metadata: { name: normalizedName } })
    return { ok: false, status: 423, error: 'Too many attempts — try again in 15 minutes' }
  }
  // An expired lock starts a fresh count. Conditional, so it can't clear a lock set meanwhile.
  if (user.pinLockedUntil) {
    await prisma.user.updateMany({
      where: { id: user.id, pinLockedUntil: { lte: now } },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    })
  }

  // Count the attempt BEFORE checking it. Read-then-write let parallel guesses
  // all read 0 and never lock; an atomic increment gives each its own number.
  const { pinFailedAttempts: attempts } = await prisma.user.update({
    where: { id: user.id },
    data: { pinFailedAttempts: { increment: 1 } },
    select: { pinFailedAttempts: true },
  })
  const lockingNow = attempts >= MAX_FAILED_ATTEMPTS
  const lock = () =>
    prisma.user.updateMany({
      where: { id: user.id, pinLockedUntil: null },
      data: { pinLockedUntil: new Date(Date.now() + LOCKOUT_MS) },
    })
  if (attempts > MAX_FAILED_ATTEMPTS) {
    await lock() // self-heals if the attempt that hit the limit never set the lock
    await logAudit({ action: 'rep_login_locked', targetUserId: user.id, metadata: { name: normalizedName, attempts } })
    return { ok: false, status: 423, error: 'Too many attempts — try again in 15 minutes' }
  }

  const valid = await bcrypt.compare(pin, user.pinHash)
  if (!valid) {
    if (lockingNow) await lock()
    await logAudit({
      action: lockingNow ? 'rep_login_locked' : 'rep_login_failed',
      targetUserId: user.id,
      metadata: { name: normalizedName, attempts },
    })
    return {
      ok: false,
      status: lockingNow ? 423 : 401,
      error: lockingNow ? 'Too many attempts — try again in 15 minutes' : 'Invalid name or PIN',
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { pinFailedAttempts: 0, pinLockedUntil: null },
  })
  await logAudit({ action: 'rep_login_success', actorUserId: user.id, targetUserId: user.id, metadata: { name: normalizedName } })

  return { ok: true, userId: user.id }
}
