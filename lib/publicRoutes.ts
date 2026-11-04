// Standalone constants, deliberately with no other imports: proxy.ts (Edge
// middleware) and app/login/page.tsx (Node runtime) both need this list, and
// importing it from lib/session.ts would pull Prisma into the Edge bundle
// (same reasoning as lib/devBypass.ts).
//
// Single source of truth for "this path skips Neon Auth's middleware" —
// proxy.ts's isPublicPage check and app/login/page.tsx's post-login redirect
// validation must agree on this list. They used to be separate, which is
// exactly how a real bug shipped: a request to "/" carrying Neon Auth's
// OAuth verifier query param needs to pass THROUGH neonAuth.middleware() to
// complete the session exchange, but "/" was (correctly) also public for a
// logged-out visitor — so an unvalidated callbackURL/redirectTo pointing at
// any of these other public paths would hit the exact same silent failure:
// a session created server-side that the browser never actually receives a
// cookie for. A crafted `/login?from=/rep/acme` link, or any other code path
// that builds a callbackURL from user input, must never resolve to one of
// these — see isSafeRedirectTarget below.
const PUBLIC_PATH_PREFIXES = ['/invite/redeem', '/signup', '/rep', '/intake', '/reset-password'] as const

export function isPublicPathPrefix(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

// Only a same-origin, path-only target starting with "/" is acceptable —
// this also closes the adjacent open-redirect (an absolute/protocol-relative
// URL like "https://evil.example" or "//evil.example" would otherwise sail
// through as a post-login destination).
export function isSafeRedirectTarget(target: string | undefined): target is string {
  if (!target) return false
  if (!target.startsWith('/') || target.startsWith('//')) return false
  if (target === '/login') return false
  // Strip query/hash before checking against the public-path list — a
  // pathname-only check must not be fooled by e.g. "/signup?x=/leads".
  const pathname = target.split(/[?#]/)[0]
  return !isPublicPathPrefix(pathname)
}
