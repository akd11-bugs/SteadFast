# Defence brief: authentication and session resolution

Scope: sign-in, sign-up, session resolution, the email-auth switch, password set/reset, the
account-not-found flow, invite redemption (as it creates accounts) and the dev-login bypass.
Line numbers are for the working tree on `development` (HEAD 9a073f4 plus an uncommitted change that
removes email-domain auto-join from `lib/session.ts` and `lib/org.ts`). If that change is dropped,
the auto-join row in section 3 applies again.

## 1. What it does

A visitor signs in at `/login` with Google, or with email and password under "Use a password
instead" (`app/login/page.tsx:106-116`). Neon Auth proves who they are; our own `User` row decides
which org and role they get (`lib/session.ts:97-112`). There is no email-domain auto-join (`lib/session.ts:105-108`).
Anyone with no `User` row lands on `/account-not-found`, where a Google user can start a new org as its admin
(`app/api/account-not-found/create-org/route.ts:17-57`). Colleagues join through an admin's invite
code (`app/api/invites/redeem/route.ts:35-201`). Email sign-up by magic link exists but is switched
off (`lib/authFlags.ts:11`). A signed-in user can set or change a password by email
(`app/api/settings/set-password/route.ts:15-28`) and finish it at `/reset-password`
(`app/api/auth-actions/reset-password/route.ts:12-30`). Deactivated users go to `/account-disabled`
(`lib/session.ts:120-124`).

## 2. Why X instead of Y

| Decision | Rejected alternative | Why |
|---|---|---|
| Neon Auth owns identity; `User` table owns role/org/isActive (`lib/auth.ts:3-13`, `lib/session.ts:63-71`) | Store roles in the auth provider | Role and org are business data; Edge middleware cannot reach Prisma (`proxy.ts:88-92`). |
| Match identity to `User` by lower-cased email (`lib/session.ts:104-105`) | Store a Neon user id on `User` | Simpler; `User.email` is already unique (`prisma/schema.prisma:380`). Cost: one org per person (`app/api/invites/redeem/route.ts:88-90`). |
| No email-domain auto-join; joining an org needs an invite (`lib/session.ts:105-109`) | Auto-join verified Google users by domain (HEAD 9a073f4) | A shared domain is not consent: contractors, ex-staff, a reseller's clients (`lib/session.ts:106-108`). |
| Org creation from `/account-not-found` needs `emailVerified` (`create-org/route.ts:20-24`) | Allow password identities | Neon's public sign-up endpoint can create a password identity for any typed address. An org must not be founded on an unproven email. |
| Email sign-up off behind a constant (`lib/authFlags.ts:1-11`), checked in the API (`app/api/signup/request/route.ts:24-26`) and UI (`app/signup/page.tsx:61`) | Leave it on | Global mailbox uses SMTP, which Render blocks. Refusing before writing a token leaves nothing behind. |
| Password sign-in stays on (`app/login/page.tsx:56-59`) | Hide it with email sign-up | Invite redeemers and admin-created users only have a password. |
| "Set password" reuses Neon's reset flow (`set-password/route.ts:7-14`) | `changePassword()` | A Google-only account has no current password to check. |
| Our own lockout + IP limit around Neon sign-in (`lib/loginLockout.ts:20-27`) | Rely on Neon | Nothing wrote `failedLoginAttempts`/`lockedUntil` before. |
| In-memory rate limiter (`lib/rateLimit.ts:3-9`) | Redis | Render runs one long-lived instance. Resets on deploy; no cross-instance sharing. |
| Dev bypass cookie, opt-in (`lib/session.ts:76-95`) | Unconditional local bypass | Google OAuth cannot finish on localhost; "/" should still show the marketing page. |

## 3. Malicious actors

| Actor | What they try | What stops them | Residual risk |
|---|---|---|---|
| Anonymous visitor | Reach app pages or APIs | `proxy.ts:86-93` sends every non-public path through `neonAuth.middleware`; route handlers call `requireApiUser` (`lib/session.ts:157-161`). | Public paths are a fixed list (`lib/publicRoutes.ts:18`) plus matcher exclusions (`proxy.ts:117-119`). |
| Anonymous visitor | Brute-force a password | 20 tries per IP per 15 min (`lib/loginLockout.ts:13-35`); 5 failures lock the account for 15 min (`:11-12`, `:47-63`). | IP is the first `X-Forwarded-For` entry (`lib/rateLimit.ts:60-64`), which a client can likely set itself (unverified how Render handles it). Anyone can lock a known email for 15 min. The failure count is incremented atomically **before** the password is checked, so parallel guesses each get their own number and only 5 ever reach Neon (audit 2026-11-23; `test/lockout.test.ts`). Google sign-in skips the lockout. |
| Anonymous visitor | Create a password identity for `ceo@victim.com` via Neon's public endpoint (`app/api/auth/[...path]/route.ts:3`) | No `User` row exists, so it resolves to `no-app-user` (`lib/session.ts:109`). Org creation needs `emailVerified` (`create-org/route.ts:22-24`). It can only redeem an invite it already holds. | None found. |
| Anonymous visitor | Open redirect via `/login?from=` | `isSafeRedirectTarget` allows only same-origin, non-public paths (`lib/publicRoutes.ts:28-44`). | None found. |
| Anonymous visitor | Cross-site POST to `/api/*` | Origin must match `x-forwarded-host` (`proxy.ts:76-84`), on top of SameSite=lax cookies. | Requests with no Origin pass (`proxy.ts:81`). Matcher-excluded routes (`proxy.ts:118`) get no Origin check. |
| Anonymous visitor | Use `/api/dev-login` in production | Route returns 404 when `NODE_ENV=production` (`app/api/dev-login/route.ts:17-19`); proxy only lets it through outside production (`proxy.ts:47`, `:53-54`); `resolveDevBypass` returns null in production (`lib/session.ts:86`) and needs `DEV_BYPASS_AUTH_EMAIL` (`:87-88`). | Three independent guards. Only a misconfigured non-production `NODE_ENV` on a public host would expose it. |
| Verified Google user at a shared domain | Join a company's org by email domain | Working tree: no auto-join; `resolveSession` only finds an existing row (`lib/session.ts:105-109`). | At HEAD 9a073f4 (committed) auto-join is live: it took the org of *any* active user at that domain, invited outsiders included, so one `consultant@partner.com` invite let every verified `@partner.com` user join as `sales`. Closed only once the uncommitted change ships. |
| Invitee | Pick their own role or org | Role and org come from the invite row (`app/api/invites/redeem/route.ts:169`, `:172`). | Invite codes never expire; there is no expiry field (`prisma/schema.prisma:509-526`). |
| Invitee | Move someone else's account | An existing account can only switch orgs while signed in as that email (`redeem/route.ts:75-84`). A sole admin with members cannot leave (`:91-101`). | Their old org's leads stay behind (`:88-90`). |
| Invitee | Learn which emails exist | Code checked before email (`redeem/route.ts:68-73`); 20 tries per IP per 15 min (`:36-43`). | Once the code is valid, 409 vs 200 still reveals registration (`:79-84`). |
| Sales rep | Act as admin | Role checks per route, e.g. invites need `isAdmin` (`app/api/invites/route.ts:15`, `:27`). | Depends on every route checking; not audited here. |
| Admin of another org | Reach this org | `orgId` comes from the session `User` row only (`lib/session.ts:42-55`); `leadScope` filters every lead query (`lib/session.ts:182-186`). | One org per user by design. |
| Holder of a leaked link/token | Reset token | Neon validates it (`reset-password/route.ts:22`); password must be 8+ chars (`:18`). | No rate limit of our own on that route; Neon's token lifetime unverified. |
| Holder of a leaked link/token | Signup token | 30 min TTL (`app/api/signup/request/route.ts:12`), claimed atomically once (`app/api/signup/complete/route.ts:37-51`). Flow is off anyway. | None while the flag is off. |
| Holder of a leaked link/token | Reusable invite link | Revocation only. Never consumed (`redeem/route.ts:111-112`). | Anyone with it joins with the invite's role, which can be `admin` (`prisma/schema.prisma:513`). |
| Tampering with OAuth callback state | Break Google sign-in | Neon's middleware exchanges `neon_auth_session_verifier` (`proxy.ts:33-41`); our code does not handle that state. | Neon's own state checks unverified. |

## 4. Data structures

| Item | Where | Why this shape |
|---|---|---|
| `User.email` unique | `prisma/schema.prisma:380` | The join key from a Neon identity. Also the race guard: duplicate inserts hit P2002 (`signup/complete/route.ts:89-93`, `create-org/route.ts:47-50`). |
| `User.role` string, default `sales` | `prisma/schema.prisma:382` | `admin|sales|operations|pending`; `pending` is unused today (`lib/session.ts:171-176`). |
| `User.isActive` | `prisma/schema.prisma:383` | Checked on every request (`lib/session.ts:110`), so deactivation works without revoking Neon sessions. |
| `User.passwordHash` nullable | `prisma/schema.prisma:381` | Legacy. New accounts write null; Neon verifies passwords (`signup/complete/route.ts:64-66`). |
| `failedLoginAttempts`, `lockedUntil` | `prisma/schema.prisma:384-385` | Per-account lockout (`lib/loginLockout.ts:47-69`). |
| `pinHash`, `pinFailedAttempts`, `pinLockedUntil` | `prisma/schema.prisma:398-402` | Field-rep PIN login, kept apart so one lockout never blocks the other. |
| `Invite` (`code` unique, `status`, `isReusable`, no expiry) | `prisma/schema.prisma:509-526` | Code is 6 random bytes, base64url (`app/api/invites/route.ts:42`, `lib/crypto.ts:73-75`). |
| `SignupToken` (`token` unique, `expiresAt`, `usedAt`, no `orgId`) | `prisma/schema.prisma:534-547` | No org exists until completion. The comment at `:528-533` describes a join-request model, not this table; it is stale. |
| `AuditLog` | `prisma/schema.prisma:549-563` | `orgId` nullable for pre-signup events. Logs login success/failure/lock (`lib/loginLockout.ts:40`, `:57-61`, `:69`). |
| Neon Auth session cookie | `lib/auth.ts:8-13` | Signed with `NEON_AUTH_COOKIE_SECRET`. Name and lifetime are set by the library (unverified). |
| `dev_bypass_auth` cookie | `lib/devBypass.ts:5`, `app/api/dev-login/route.ts:25` | `httpOnly`, `sameSite=lax`, value `1`. Has no meaning in production. |

## 5. Where it fails

| Failure | What the user sees | How we notice |
|---|---|---|
| Google sign-in errors | "Google sign-in didn't go through" (`app/login/page.tsx:49-52`, `:95`) | `console.error('[login] Google sign-in failed')` (`:50`). |
| Account locked / IP limited | "Too many failed attempts" or "Too many attempts" (`app/login/page.tsx:96-104`) | `login_locked` audit rows (`lib/loginLockout.ts:40`, `:57-61`). |
| Neon Auth down | `getSession` gets no data, so everyone looks signed out and goes to `/login` (`lib/session.ts:101-102`). | Unverified: no alerting found. |
| Neon sign-up fails during invite/signup | 409 with the message; the code or token is released for retry (`redeem/route.ts:146-161`, `signup/complete/route.ts:67-74`). | Client error only. |
| Login created but `User` insert fails | "Your login was created but joining the workspace failed" (`redeem/route.ts:181-185`) | `console.error('[invites/redeem] user.create failed')`. |
| Two concurrent org creations for one email | Loser gets 409. Its empty org row is left orphaned (`create-org/route.ts:36-51`, `signup/complete/route.ts:77-93`). | Accepted limit: orphan orgs are not cleaned up. |
| Email sign-up attempted | 503 "Email sign-up is unavailable" (`app/api/signup/request/route.ts:24-26`) | Expected while the flag is off. |
| Deploy or restart | All rate-limit counters reset (`lib/rateLimit.ts:3-9`). | Accepted limit. |

Accepted limits (`shortcut:` comments): one org per user, so an invite moves the account and leaves
its leads behind (`app/api/invites/redeem/route.ts:88-90`). Stale comment: `app/api/signup/request/route.ts:18-20`
says requesters land as `pending`, but completion creates an `admin` of a new org
(`app/api/signup/complete/route.ts:87`). `lib/session.ts:63-71` still describes the removed auto-join.
