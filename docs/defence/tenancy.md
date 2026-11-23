# Defence brief: tenancy and `leadScope`

Branch `development`. Line numbers are true of the working tree on 2026-11-22. Phase 1 fixes are
being made in that tree right now and are **not committed**. Where committed
`HEAD` on `development` differs, both are cited.

## 1. What it does

Each customer company is one `Organization`. A signed-in person sees only
their own org's data. Admins and operations staff see every lead in their org.
Sales reps see only the leads they own, inside their org. Field reps have no
email. They sign in at `/rep/<slug>` with a name and a 6-digit PIN, and get
the same scoping as any other user with their role. Asking for another org's
record by id returns "not found", as if it never existed.

## 2. Why X instead of Y

| Decision | Rejected alternative | Why |
|---|---|---|
| One helper, `leadScope(user)`, spread into every lead query (`lib/session.ts:182-186`) | Each route writes its own filter | One place for the rule. The `orgId` term is applied to every role, never bypassed (`lib/session.ts:178-180`). |
| `visibleOrgIds` is an array that is always `[orgId]` (`lib/session.ts:19-22`, `34-36`) | Inline `orgId` everywhere | Left over from removed org hierarchy. Kept so `leadScope` did not change shape. Orgs are flat. |
| Roles are a plain string: `admin`, `operations`, `sales`, `pending` (`prisma/schema.prisma:382`, `lib/session.ts:163-176`) | Permission tables | Three real roles. `pending` is never created today (`lib/session.ts:171-173`). |
| `findFirst({ where: { id, ...leadScope(user) } })` (e.g. `app/leads/[id]/page.tsx:15-16`, `app/api/rep/leads/[id]/route.ts:18-19`) | `findUnique({ where: { id } })` | Ids are global. `findUnique` by id alone skips the tenant filter. |
| 404 for another org's row (`app/leads/[id]/page.tsx:24`, `app/api/invites/[id]/route.ts:15`, `app/api/users/[id]/pin/route.ts:17`) | 403 | 403 confirms the id exists in some other tenant. |
| Rep login takes the org from the URL slug (`app/api/rep/login/route.ts:42`) and looks up `(orgId, name)` (`lib/repAuth.ts:28-30`) | Search `User.name` across all orgs | The old global search locked out both tenants when two orgs had a rep with the same name (`lib/repAuth.ts:20-25`). |
| Separate `rep_session` cookie and secret (`lib/repSession.ts:7`, `10-14`, `20-22`) | Reuse the dashboard session | A dashboard session never grants rep access, and the reverse. |
| Rep session re-reads the `User` row on every request (`lib/repSession.ts:63-78`) | Trust the token until expiry | Deactivation or role change applies on the next request. |
| App-level filter only | Postgres row-level security | Not built. Unverified whether it was considered. See section 5. |

## 3. Malicious actors

| Actor | What they try | What stops them |
|---|---|---|
| Anonymous visitor | Call any API | `requireApiUser()` returns 401 for any non-`ok` session (`lib/session.ts:157-160`). Pages redirect (`lib/session.ts:120-124`, `130-136`). Tested: `test/tenantIsolation.test.ts:83`. |
| Anonymous visitor | Use the dev auth bypass | Off when `NODE_ENV === 'production'` (`lib/session.ts:86`), and needs a cookie plus an env email (`lib/session.ts:87-90`). |
| Anonymous visitor | Guess rep PINs | 5 failures lock that rep for 15 min. The attempt is counted atomically before bcrypt runs, so 20 parallel guesses check at most 5 (`lib/repAuth.ts`, `verifyRepLogin`; `test/lockout.test.ts`). 20 attempts per IP per 15 min (`app/api/rep/login/route.ts:13-24`). |
| Anonymous visitor | Probe which org slugs exist | Unknown slug gives the same "Invalid name or PIN" 401 as a bad PIN (`app/api/rep/login/route.ts:39-45`). But an unknown name in a real org also gives 401 (`lib/repAuth.ts:32-35`), while a locked real name gives 423 (`lib/repAuth.ts:37-40`). That 423 confirms a name exists in that org. |
| Sales rep | Open a colleague's lead by URL | `leadScope` adds `ownerId: user.id` for sales (`lib/session.ts:185`). Miss is 404. Tested: `test/tenantIsolation.test.ts:105`, `test/integration.test.ts:85`. |
| Sales rep | Write an activity on a lead they do not own | Activities route checks the lead is in scope first. Tested: `test/tenantIsolation.test.ts:196`. |
| Sales rep | Forge or extend a rep cookie | HMAC-SHA256 with a server secret, constant-time compare, expiry checked (`lib/repSession.ts:28-39`). |
| Admin of another org | Read or delete org A's lead by its real id | `findFirst` + `leadScope` on `/api/leads/[id]`. Tested: `test/tenantIsolation.test.ts:121`, `164`, and against a real two-org DB: `test/integration.test.ts:66-83`. |
| Admin of another org | Revoke org A's invite or reset an org A rep's PIN | Both look up with `orgId: { in: user.visibleOrgIds }` and 404 (`app/api/invites/[id]/route.ts:14-15`, `app/api/users/[id]/pin/route.ts:16-17`). |
| Admin of another org | Lock out org A's rep by sharing a name | Lookup is per org (`lib/repAuth.ts:28-30`). Tested: `test/integration.test.ts:129`. |
| Holder of a leaked rep link | Sign in as a rep | Needs the rep's exact name and current PIN too. The slug alone is public by design. |
| Holder of a stolen `rep_session` cookie | Act as the rep | Works until expiry, max 10 h (`lib/repSession.ts:8`). No server-side revocation list. Deactivating the user or clearing the PIN ends it (`lib/repSession.ts:78`). |

### Residual risks (honest)

- **Lead detail page by id.** Committed `HEAD` loads the lead with
  `findUnique({ where: { id } })` (`git show HEAD:app/leads/[id]/page.tsx`, line 13)
  and only checks owner for sales. An admin or ops user of org B could read
  org A's lead by id. The working tree fixes it (`app/leads/[id]/page.tsx:15-16`),
  **uncommitted**, with new tests (`test/tenantIsolation.test.ts:128-152`). Phase 1.
- **Owner dropdown on `/leads`.** Committed `HEAD` lists all active users in every
  org (`git show HEAD:app/leads/page.tsx`, line 112). That leaks names and ids
  across tenants to admins. The working tree adds the `orgId` filter
  (`app/leads/page.tsx:78`), **uncommitted**, tested at `test/tenantIsolation.test.ts:154-160`. Phase 1.
- **Old PIN follows a moved user.** See `docs/defence/invites.md`, section 3.
- **The rule is opt-in.** Any new query that forgets `leadScope` leaks. Nothing at
  the database level stops it.

## 4. Data structures

| Item | Shape | Why |
|---|---|---|
| `Organization.id` | cuid (`prisma/schema.prisma:17`) | The tenant key. Flat, no parent (`prisma/schema.prisma:13-15`). |
| `Organization.slug` | `String? @unique` (`prisma/schema.prisma:32`) | Public rep-login segment. Unique so one slug is one tenant. Nullable until backfilled (`prisma/schema.prisma:29-31`). |
| `Lead.orgId`, `Lead.ownerId` | `String`; `ownerId` defaults to `"self"` (`prisma/schema.prisma:323`, `336`) | `orgId` is the boundary. `ownerId` is a plain string, no FK, so imports with unknown owners still save (`prisma/schema.prisma:404-405`). |
| Lead indexes | `@@index([orgId])`, `@@index([ownerId])` (`prisma/schema.prisma:364`, `366`) | Every scoped query filters on these. No composite `(orgId, ownerId)` index. |
| `User.email` | `@unique` (`prisma/schema.prisma:380`) | One account per email, so one org per person. |
| `User.role`, `User.isActive` | string, bool (`prisma/schema.prisma:382-383`) | Read by `leadScope` and every session check. |
| `User.pinHash`, `pinFailedAttempts`, `pinLockedUntil` | (`prisma/schema.prisma:400-402`) | Rep PIN, bcrypt cost 10 (`app/api/users/[id]/pin/route.ts:26`). Separate counters from the dashboard login (`lib/repAuth.ts:12-14`). |
| `@@unique([orgId, name])` on User | (`prisma/schema.prisma:410`) | Rep login resolves by name, so a name must be unique inside an org. |
| `rep_session` cookie | `"<userId>.<expiryMs>.<hmac>"` (`lib/repSession.ts:20-26`), httpOnly, `sameSite: lax`, `secure` in prod, path `/`, 10 h (`lib/repSession.ts:45-55`) | Path `/` so it reaches `/api/rep/*` (`lib/repSession.ts:49-52`). No DB row: stateless. |
| `SessionUser` | in-memory object (`lib/session.ts:13-32`) | Built per request by `hydrate`, cached with React `cache()` (`lib/session.ts:42-55`). |

## 5. Where it fails

| Failure | What the user sees | How we notice |
|---|---|---|
| Org has no slug yet | Rep login always says "Invalid name or PIN" (`app/api/rep/login/route.ts:42-45`) | Rep complaint. `test/integration.test.ts:156` checks the fixture, not production. |
| Rep locked out | "Too many attempts — try again in 15 minutes" (`lib/repAuth.ts:39`) | `rep_login_locked` audit row (`lib/repAuth.ts:38`, `54`). |
| Lead owned by `"self"` or a deleted user | Invisible to every sales rep; admins still see it (`lib/session.ts:183-185`) | Nothing alerts. |
| A route forgets `leadScope` | Cross-tenant read or write, silently | Only if the route is in `test/tenantIsolation.test.ts`. It imports four API routes (`test/tenantIsolation.test.ts:60-63`) plus, in the working tree, the two `/leads` pages (`test/tenantIsolation.test.ts:128-160`), all with a mocked Prisma, so it checks the `where` clause, not real rows. |
| `TEST_DATABASE_URL` unset | `test/integration.test.ts` is skipped (`test/integration.test.ts:16-17`) | Silent in CI. |
| Rate limiter after restart or on 2+ instances | Counters reset or split (`lib/rateLimit.ts:3-9`) | Nothing. Accepted. |
| Rate limiter keyed on `x-forwarded-for` first entry (`lib/rateLimit.ts:52-55`) | A client that sends its own header may get fresh buckets | Unverified: depends on how Render's proxy rewrites the header. Per-account PIN lockout still applies. |

**Accepted limits.** No `shortcut:` comment exists in the tenancy code
(`lib/session.ts`, `lib/repAuth.ts`, `lib/repSession.ts`). The known limits are
the comments above: in-memory rate limiting (`lib/rateLimit.ts:3-9`) and the
always-one-element `visibleOrgIds` (`lib/session.ts:19-22`).
