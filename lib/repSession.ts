import crypto from 'crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { resolveVisibleOrgIds, type SessionUser } from '@/lib/session'
import { BRAND_NAME } from '@/lib/branding'

const COOKIE_NAME = 'rep_session'
const MAX_AGE_SECONDS = 10 * 60 * 60 // 10h

function secret() {
  const s = process.env.REP_SESSION_SECRET
  if (!s) throw new Error('REP_SESSION_SECRET is not set')
  return s
}

function sign(payload: string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex')
}

// Token shape: "<userId>.<expiryMs>.<hmac>" — kept out of NextAuth entirely
// (separate cookie, separate secret, separate path) so a real dashboard
// session never grants rep access and vice versa.
function makeToken(userId: string, expiresAt: number) {
  const payload = `${userId}.${expiresAt}`
  return `${payload}.${sign(payload)}`
}

function verifyToken(token: string): { userId: string; expiresAt: number } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, expiresAtRaw, mac] = parts
  const payload = `${userId}.${expiresAtRaw}`
  const expected = sign(payload)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null
  return { userId, expiresAt }
}

export async function setRepSessionCookie(userId: string) {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000
  const store = await cookies()
  store.set(COOKIE_NAME, makeToken(userId, expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    // Must cover both /rep (the page) and /api/rep (the routes it calls) —
    // cookie path-matching is a literal path-segment prefix, so "/rep" alone
    // never gets sent back to "/api/rep/*". A distinct httpOnly cookie name
    // is what actually keeps this separate from NextAuth, not the path.
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function clearRepSessionCookie() {
  const store = await cookies()
  store.delete({ name: COOKIE_NAME, path: '/' })
}

// Re-reads the User row fresh on every call — a deactivated account or a
// role change is rejected on its very next request, not just once the token
// naturally expires. Returns a plain SessionUser so it plugs directly into
// the existing leadScope()/isAdmin()/isOperations() helpers unmodified.
export async function getRepSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  const verified = verifyToken(token)
  if (!verified) return null

  const user = await prisma.user.findUnique({
    where: { id: verified.userId },
    select: { id: true, name: true, email: true, role: true, orgId: true, isActive: true, pinHash: true },
  })
  if (!user || !user.isActive || !user.pinHash) return null

  const visibleOrgIds = resolveVisibleOrgIds(user.orgId)
  // Rep sessions are only ever consumed by API routes (lib/session.ts's
  // own doc comment above), never rendered through Sidebar/TopBar — org
  // branding fields are irrelevant here, so they're left at their defaults
  // rather than spending an extra Organization query on every rep request.
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    orgId: user.orgId,
    visibleOrgIds,
    orgName: BRAND_NAME,
    orgLogoUrl: null,
    orgLogoDataUrl: null,
    orgBrandColor: null,
  }
}
