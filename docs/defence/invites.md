# Defence brief: invites, workspace moves, domain auto-join

Branch `development`. Line numbers are true of the working tree on 2026-11-22.
`HEAD:path:line` means the committed `HEAD` of `development`. Domain auto-join
exists only there: the uncommitted working tree already removes it
(`lib/session.ts:104-108`; `findOrgByEmailDomain` is gone from `lib/org.ts`;
`lib/sessionAutoJoin.test.ts:29` now asserts no auto-join).

## 1. What it does

An admin creates an invite code for a role (admin, sales or operations). It is
either for one named person or a reusable link. The invitee opens the redeem
page, types the code, and either sets an email and password (new person) or,
if already signed in, just joins. An existing account can use an invite to
move to another workspace, but only while signed in as that email; its old
leads stay behind. Separately, a person who signs in with Google, has no
account, and whose email domain matches an existing org, is added to that org
as `sales` with no approval. That domain auto-join is scheduled to be removed
in Phase 1, and the working tree already removes it (uncommitted).

## 2. Why X instead of Y

| Decision | Rejected alternative | Why |
|---|---|---|
| Random 6-byte base64url code (`app/api/invites/route.ts:42`, `lib/crypto.ts:73-75`) | Emailed magic link only | Works without outbound email. ~48 bits, not practical to brute force (`app/api/invites/redeem/route.ts:13-16`). |
| Reusable link never consumed (`app/api/invites/redeem/route.ts:111-112`, `prisma/schema.prisma:516-519`) | One code per person only | Lets an admin onboard a team with one link. Stays live until revoked. |
| Atomic claim with `updateMany where status='pending'` (`app/api/invites/redeem/route.ts:115-122`) | Read then write | Two redeems of one code at once: only one wins. |
| Release the claim if account creation fails (`app/api/invites/redeem/route.ts:30-33`, `153`, `177`) | Keep it burned | A failed sign-up should not waste the code. |
| Check the code before the email (`app/api/invites/redeem/route.ts:68-73`) | Email first | Email-first let anyone learn which emails are registered (409 vs 410). |
| Move an existing account only with a live session for that email (`app/api/invites/redeem/route.ts:75-84`) | Move by typed email | Otherwise anyone could move anyone. |
| Move the account instead of adding a second membership (`app/api/invites/redeem/route.ts:88-90`) | Multi-org membership | `User.email` is unique (`prisma/schema.prisma:380`). Marked `shortcut:`. |
| Block the only admin of a non-empty org from leaving (`app/api/invites/redeem/route.ts:91-102`) | Allow it | Would leave a team with no admin. |
| Revoke is conditional on still-pending (`app/api/invites/[id]/route.ts:20-25`) | Unconditional update | A redeem that lands mid-revoke is not overwritten. |
| Domain auto-join only for a verified (Google) identity (`HEAD:lib/session.ts:133-136`) | Any identity | A password identity can be made for any typed address. |
| Domain match by scanning existing users (`HEAD:lib/org.ts:106-116`) | `Organization.domain` column | Reuses data that exists (`HEAD:lib/org.ts:101-102`). See residual risk below. |

## 3. Malicious actors

| Actor | What they try | What stops them |
|---|---|---|
| Anonymous visitor | Guess invite codes | ~48-bit code; 20 tries per IP per 15 min (`app/api/invites/redeem/route.ts:36-43`). |
| Anonymous visitor | Learn registered emails via redeem | Junk code always 410 first (`app/api/invites/redeem/route.ts:70-73`). Tested: `test/inviteRoutes.test.ts:253`. |
| Anonymous visitor | Move someone's account by typing their email | Existing email without a session is refused 409 (`app/api/invites/redeem/route.ts:78-84`). Tested: `test/inviteRoutes.test.ts:304`. |
| Anonymous visitor | List, create or revoke invites | Those routes need a session and `admin` (`app/api/invites/route.ts:13-15`, `25-27`; `app/api/invites/[id]/route.ts:9-11`). Only `api/invites/redeem` is outside the auth wall (`proxy.ts:118`). |
| Invitee | Pick a higher role | Role comes from the invite row (`app/api/invites/redeem/route.ts:169`, `172`), set by the admin. Unknown roles fall back to `sales` (`app/api/invites/route.ts:33`). |
| Invitee | Redeem a one-person code twice | Status flips to `redeemed` atomically (`app/api/invites/redeem/route.ts:116-120`). Tested: `test/inviteRoutes.test.ts:313`. |
| Invitee | Sign up with an email they do not own | **Not stopped.** The cold path takes any typed email (`app/api/invites/redeem/route.ts:56`) and creates a login for it (`147`). No email verification. |
| Sales rep | Create invites | 403 for non-admins (`app/api/invites/route.ts:27`). Tested: `test/inviteRoutes.test.ts:106`. |
| Admin of another org | Revoke org A's invite | Lookup scoped to own org, 404 otherwise (`app/api/invites/[id]/route.ts:14-15`). Tested: `test/inviteRoutes.test.ts:143`. |
| Admin of another org | Create an invite into org A | `orgId` comes from the session, not the body (`app/api/invites/route.ts:42`). Tested: `test/inviteRoutes.test.ts:120`. |
| Admin of another org | Pull Google users of company X into their org (domain poisoning) | **Not stopped at `HEAD`.** See residual risk 1. Gone in the working tree. |
| Holder of a leaked one-person code | Join as that person | Works until redeemed or revoked. No expiry field exists (`prisma/schema.prisma:509-525`). |
| Holder of a leaked reusable link | Join the org, repeatedly | Works until an admin revokes it (`prisma/schema.prisma:516-519`). Each use is in the audit log (`app/api/invites/redeem/route.ts:192-198`). |

### Residual risks (honest)

1. **Domain auto-join can be poisoned.** `findOrgByEmailDomain` picks the org
   of *any* active user whose email ends in that domain (`HEAD:lib/org.ts:110-113`).
   An admin of org B can put a `@victimco.com` user into org B without owning
   that address: via a reusable invite redeemed with a typed email
   (`app/api/invites/redeem/route.ts:171-173`) or admin user-create
   (`app/api/users/route.ts:52-53`). After that, a new `@victimco.com` Google
   sign-in may auto-join org B as `sales` (`HEAD:lib/session.ts:136`, `112-114`).
   If victimco also has a real org, which one wins is undefined: `findFirst`
   has no `orderBy` (`HEAD:lib/org.ts:110-113`). Open at committed `HEAD`; the
   uncommitted working tree closes it by removing auto-join (`lib/session.ts:104-108`).
2. ~~A moved user keeps their old PIN~~ **Fixed in Phase 1.** The old org's
   admin chose that PIN and could have used it at the new org's `/rep/<slug>`.
   The move now clears `pinHash`, `pinFailedAttempts` and `pinLockedUntil`
   (`app/api/invites/redeem/route.ts`, the `existingUser` update). Tested:
   `test/inviteRoutes.test.ts` ("signed in with an existing account").
3. **A deactivated user can reactivate by moving.** The move sets
   `isActive: true` (`app/api/invites/redeem/route.ts:169`). The new org's admin
   invited them, so this is probably intended. Unverified as a decision.
4. **Signed-in path trusts any Neon session.** It does not check
   `emailVerified` (`app/api/invites/redeem/route.ts:50-56`). Whether Neon
   lets someone open a password session for an email that already has a
   Google identity is unverified.

## 4. Data structures

| Item | Shape | Why |
|---|---|---|
| `Invite.code` | `String @unique` (`prisma/schema.prisma:514`) | Lookup key for redeem; unique so retries on collision (`app/api/invites/route.ts:39-48`). Stored plaintext; admins see it in the list (`app/api/invites/route.ts:17-21`). |
| `Invite.status` | `pending \| redeemed \| revoked` string (`prisma/schema.prisma:515`) | Claim and revoke are both conditional on `pending`. |
| `Invite.isReusable` | bool (`prisma/schema.prisma:519`) | Reusable links skip the claim. |
| `Invite.name` | nullable (`prisma/schema.prisma:512`) | A reusable link names nobody. Required for one-person (`app/api/invites/route.ts:36`). |
| `Invite.role` | string (`prisma/schema.prisma:513`) | Copied onto the user at redeem. |
| `Invite.redeemedByUserId` | single value (`prisma/schema.prisma:523`) | For reusable links only the latest redeemer; full history is the audit log (`app/api/invites/redeem/route.ts:187-190`). |
| `@@index([orgId, status])` | (`prisma/schema.prisma:525`) | The admin list filters by org. |
| No `expiresAt` on Invite | (`prisma/schema.prisma:509-525`) | Codes live until used or revoked. `SignupToken` does have one (`prisma/schema.prisma:538`). |
| `User.email @unique` | (`prisma/schema.prisma:380`) | Forces one org per person, hence "move, not join". |
| `AuditLog` | `invite_created/redeemed/revoked`, JSON `metadata` (`prisma/schema.prisma:549-563`) | Redeem records `movedFromOrgId` on a move (`app/api/invites/redeem/route.ts:197`). |
| Rate-limit buckets | in-memory `Map` (`lib/rateLimit.ts:16`) | No table. Resets on restart (`lib/rateLimit.ts:3-9`). |

## 5. Where it fails

| Failure | What the user sees | How we notice |
|---|---|---|
| Login exists, no account here | "This email already has a login. Sign in with it first…" (`app/api/invites/redeem/route.ts:157-160`); code released | Support ticket. Tested: `test/inviteRoutes.test.ts:268`. |
| Login created, `User` row fails | 500 "Your login was created but joining the workspace failed…" (`app/api/invites/redeem/route.ts:181-185`) | `console.error` line (`181`). A Neon identity without a `User` row is left behind. |
| Already in that workspace | 409 (`app/api/invites/redeem/route.ts:85-87`) | None needed. |
| Only admin tries to leave | 409 "Make someone else admin there first" (`app/api/invites/redeem/route.ts:96-100`) | Tested: `test/inviteRoutes.test.ts:291`. |
| User moves orgs | Old org keeps their leads with `ownerId` pointing at someone no longer there. Sales can't see them; admins can (`lib/session.ts:183-185`) | `movedFromOrgId` in audit (`app/api/invites/redeem/route.ts:197`). Nothing alerts the old admin. |
| Moved user's name already exists in the new org | `@@unique([orgId, name])` (`prisma/schema.prisma:410`) fails the update; user sees the misleading "That email is already registered — log in instead" (`app/api/invites/redeem/route.ts:178-179`). Invite is released. | Support ticket only. Unverified in a test. |
| Concurrent redeem of one code | Loser gets 410 (`app/api/invites/redeem/route.ts:123-125`) | Tested: `test/inviteRoutes.test.ts:313`. |
| Domain match finds the wrong org | User lands in an org they don't belong to, as `sales` | Not detected. Only at `HEAD`; removed in the working tree. |
| Rate limit after restart | Counters reset (`lib/rateLimit.ts:3-9`) | Nothing. Accepted. |

**Accepted limits (`shortcut:` comments).**
- `app/api/invites/redeem/route.ts:88-90`: one org per user, so joining moves the
  account and its old workspace and leads stay behind. Upgrade when multi-org
  membership is built.
- No other `shortcut:` comment in the invite or auto-join code.

**Tests.** Invite routes: `test/inviteRoutes.test.ts:106-326` (mocked Prisma).
Auto-join: `HEAD:lib/sessionAutoJoin.test.ts:34-86`, including "never auto-joins an
unverified identity" (`HEAD:lib/sessionAutoJoin.test.ts:74`). The PIN reset on a move is asserted in the same test file.
