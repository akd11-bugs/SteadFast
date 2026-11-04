import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { neonAuth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Prisma, type User } from '@prisma/client'
import { DEV_BYPASS_COOKIE } from '@/lib/devBypass'
import { BRAND_NAME } from '@/lib/branding'
import { findOrgByEmailDomain } from '@/lib/org'

export { DEV_BYPASS_COOKIE }

export interface SessionUser {
  id: string
  name: string
  email: string
  role: string
  orgId: string
  // Always exactly [orgId] — orgs are flat, no cross-org visibility exists.
  // Kept as an array (rather than inlining orgId everywhere) so leadScope()
  // below didn't need to change shape when hierarchy was removed.
  visibleOrgIds: string[]
  // The signed-in user's own org name/logo/accent — see
  // components/branding/OrgLogo.tsx, the single place that renders these.
  // orgName falls back to the global NEXT_PUBLIC_BRAND_NAME (lib/branding.ts)
  // for an org that hasn't set its own name yet, same precedence OrgLogo
  // already uses for the logo itself.
  orgName: string
  orgLogoUrl: string | null
  orgLogoDataUrl: string | null
  orgBrandColor: string | null
}

export function resolveVisibleOrgIds(orgId: string): string[] {
  return [orgId]
}

// React cache()'d per-request like resolveSession() above — every
// requireUser()/requireAnyUser() call in the same request tree (layout,
// page, nested Server Components) shares this one Organization lookup
// rather than re-querying it per caller.
const hydrate = cache(async (user: Pick<User, 'id' | 'name' | 'email' | 'role' | 'orgId'>): Promise<SessionUser> => {
  const org = await prisma.organization.findUnique({
    where: { id: user.orgId },
    select: { name: true, logoUrl: true, logoDataUrl: true, brandColor: true },
  })
  return {
    ...user,
    visibleOrgIds: resolveVisibleOrgIds(user.orgId),
    orgName: org?.name || BRAND_NAME,
    orgLogoUrl: org?.logoUrl ?? null,
    orgLogoDataUrl: org?.logoDataUrl ?? null,
    orgBrandColor: org?.brandColor ?? null,
  }
})

type SessionResolution =
  | { kind: 'no-session' }
  | { kind: 'no-app-user' }
  | { kind: 'inactive' }
  | { kind: 'ok'; user: User }

// Neon Auth owns identity only (email/password, Google, ...) — it knows
// nothing about role/orgId/isActive, which are our own business logic on the
// `User` table. This looks up that row by email, auto-creating one (as a
// non-admin 'sales' role) the first time a verified identity's email domain
// matches an existing org — see findOrgOwnedAutoJoin below for why that's
// safe to do with no approval step. Anything that doesn't domain-match
// still gets no row created here; that email lands on /account-not-found to
// either start its own org or finish via an admin-issued invite code
// instead.
// Exported for app/login/page.tsx, which needs to tell 'ok' apart from
// 'inactive'/'no-app-user' for its own "already signed in?" check — unlike
// requireUser()/requireAnyUser() below, it must render the login form
// rather than redirect for 'no-session'.
// Local-only auth bypass: Google OAuth can't complete against localhost
// because the Neon Auth project's trusted origins only list the production
// URL, which isn't something this repo can fix. Opt-in via a cookie (set by
// visiting /api/dev-login, see that route) rather than unconditionally, so
// "/" with no cookie still renders the public marketing page like normal —
// only a visitor who deliberately asked for the bypass skips real auth.
// Gated on NODE_ENV in addition to the cookie so this can never do anything
// outside `next dev`/`next build` locally — Render always runs with
// NODE_ENV=production regardless of what's in env.
async function resolveDevBypass(): Promise<SessionResolution | null> {
  if (process.env.NODE_ENV === 'production') return null
  const email = process.env.DEV_BYPASS_AUTH_EMAIL?.trim().toLowerCase()
  if (!email) return null
  const jar = await cookies()
  if (jar.get(DEV_BYPASS_COOKIE)?.value !== '1') return null
  const appUser = await prisma.user.findUnique({ where: { email } })
  if (!appUser) return { kind: 'no-app-user' }
  if (!appUser.isActive) return { kind: 'inactive' }
  return { kind: 'ok', user: appUser }
}

// A verified Neon Auth identity (so this is never reachable by just typing
// an email somewhere — she already proved she owns it, via Google or a
// password she set) whose domain matches a real, already-registered org
// joins instantly as 'sales' — no admin approval step, since the domain
// match is itself the authorization: anyone at that company's own email
// domain is assumed to belong there. An admin can still change her role or
// deactivate her afterward from Settings -> Organisation, same as anyone
// else. Returns null (not auto-joined) for a personal-email domain or one
// with no matching org yet.
async function autoJoinByEmailDomain(email: string, name: string): Promise<User | null> {
  const matchedOrg = await findOrgByEmailDomain(email)
  if (!matchedOrg) return null

  try {
    return await prisma.user.create({
      data: { orgId: matchedOrg.id, name: name || email, email, passwordHash: null, role: 'sales', isActive: true },
    })
  } catch (err) {
    // Someone else's concurrent request (or a stale cache) won the race to
    // create this same email — just use the row that landed, not an error.
    const isDuplicateEmail = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
    if (!isDuplicateEmail) throw err
    return prisma.user.findUnique({ where: { email } })
  }
}

export const resolveSession = cache(async (): Promise<SessionResolution> => {
  const bypass = await resolveDevBypass()
  if (bypass) return bypass

  const { data } = await neonAuth.getSession()
  if (!data?.user?.email) return { kind: 'no-session' }

  const email = data.user.email.trim().toLowerCase()
  let appUser = await prisma.user.findUnique({ where: { email } })
  if (!appUser) appUser = await autoJoinByEmailDomain(email, data.user.name ?? '')
  if (!appUser) return { kind: 'no-app-user' }
  if (!appUser.isActive) return { kind: 'inactive' }
  return { kind: 'ok', user: appUser }
})

// Shared by requireUser()/requireAnyUser() below — every non-'ok' state
// has exactly one redirect target, and app/login/page.tsx's own "already
// signed in?" check (which only has a raw Neon Auth session to go on, not
// a resolved SessionResolution) redirects to the same /account-disabled
// target for 'inactive', so a deactivated account can't loop between here
// and /login.
function redirectForUnresolved(resolution: Exclude<SessionResolution, { kind: 'ok' }>): never {
  if (resolution.kind === 'inactive') redirect('/account-disabled')
  if (resolution.kind === 'no-app-user') redirect('/account-not-found')
  redirect('/login')
}

// For Server Components/pages — sends anonymous visitors to /login, sends
// an authenticated-but-unregistered identity to /account-not-found (see
// that page for why it's not auto-provisioned), a deactivated account to
// /account-disabled, and gates `pending`-role users to /pending.
export async function requireUser(): Promise<SessionUser> {
  const resolution = await resolveSession()
  if (resolution.kind !== 'ok') redirectForUnresolved(resolution)
  const user = await hydrate(resolution.user)
  if (isPending(user)) redirect('/pending')
  return user
}

// Same as requireUser(), but doesn't bounce a pending user away — for
// app/pending/page.tsx itself, which would otherwise redirect-loop.
export async function requireAnyUser(): Promise<SessionUser> {
  const resolution = await resolveSession()
  if (resolution.kind !== 'ok') redirectForUnresolved(resolution)
  return hydrate(resolution.user)
}

// For the root layout, which must render for logged-out visitors too
// (e.g. /login, /signup, /account-not-found itself) — never redirects,
// just null for any non-'ok' state.
export async function getOptionalUser(): Promise<SessionUser | null> {
  const resolution = await resolveSession()
  return resolution.kind === 'ok' ? hydrate(resolution.user) : null
}

// For Route Handlers — a redirect would break `res.json()` on the client, so
// this returns a 401 instead. Callers must check `instanceof NextResponse`
// and return it directly.
export async function requireApiUser(): Promise<SessionUser | NextResponse> {
  const resolution = await resolveSession()
  if (resolution.kind !== 'ok') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return hydrate(resolution.user)
}

export function isAdmin(user: SessionUser) {
  return user.role === 'admin'
}

export function isOperations(user: SessionUser) {
  return user.role === 'operations'
}

// True for a user with no real role assigned — nothing currently creates
// one this way (self-serve signup assigns 'admin' to the founding user,
// invite/admin-create assign a real role), kept only in case that changes.
export function isPending(user: SessionUser) {
  return user.role === 'pending'
}

// Admin/Operations see every lead in their own org (no ownerId restriction);
// Sales sees only leads they own, within their own org. The orgId filter
// applies to every role — it's the tenant boundary, never bypassed by role.
// Spread this into any `prisma.lead.findMany`/`findUnique` where clause.
export function leadScope(user: SessionUser) {
  return isAdmin(user) || isOperations(user)
    ? { orgId: { in: user.visibleOrgIds } }
    : { orgId: { in: user.visibleOrgIds }, ownerId: user.id }
}

// Where a role lands right after login / when hitting "/" directly.
export function roleHome(user: SessionUser) {
  return isOperations(user) ? '/onboarding' : '/'
}
