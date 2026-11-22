# Defence brief: Gmail OAuth sending and SMTP fallback

Scope: `POST /api/email/send`, personal Gmail connect (`/api/settings/email/oauth/start` and
`/callback`), personal disconnect (`/api/settings/email`), org SMTP settings
(`/api/settings/org-email`), token storage and refresh in `lib/email.ts` and `lib/crypto.ts`.
Line numbers are as of branch `development` at commit 9a073f4.

## 1. What it does

A user clicks "Connect Gmail" in Settings (`components/settings/EmailSettingsCard.tsx:72`). Google
asks them to let the app send mail as them. After that, emails they send from a lead, to a custom
address, from workflow rules, or in the daily report go out through the Gmail API from their own
address (`lib/email.ts:134-189`; callers `app/api/email/send/route.ts:54`, `:91`,
`lib/workflow.ts:109`, `lib/dailyReportEmail.ts:100-101`). If they have not connected Gmail, or
the connection is broken, the email goes through the org's own SMTP mailbox set by an admin, and
if there is none, through the global mailbox from env vars (`lib/email.ts:96-99`). A lead email is
logged as an activity on that lead (`app/api/email/send/route.ts:56-65`).

## 2. Why X instead of Y

| Decision | Rejected alternative | Why |
|---|---|---|
| Gmail API over HTTPS (`lib/email.ts:178-183`) | Personal SMTP with an app password | Render blocks outbound SMTP on 465 and 587 (`lib/email.ts:130-132`, `prisma/schema.prisma:388-393`). |
| Reuse the sign-in Google OAuth client (`app/api/settings/email/oauth/start/route.ts:9-15`) | A second Google client | One client to maintain. The exchange, scope, redirect URI and token storage are still separate from Neon Auth. |
| `access_type=offline`, `prompt=consent` (`start/route.ts:42-48`) | Default consent | Google returns no refresh token on a repeat consent, and sign-in already consented once. |
| Ask for only `gmail.send`, `openid`, `email` (`start/route.ts:49`) | Broader Gmail scopes | Least privilege. We never read mail. |
| Reject a grant missing `gmail.send` (`callback/route.ts:44-48`) | Accept any grant | The consent screen lets users untick sending; Settings would say "connected" while every send fails. |
| Take the from-address from a verified ID token (`callback/route.ts:50-52`) | Let the user type it | The address is the Google account that granted access. |
| AES-256-GCM, random 12-byte IV, `iv:tag:ciphertext` (`lib/crypto.ts:25-33`) | Plaintext, or a KMS | Authenticated encryption with no extra service. A tampered value fails to decrypt (`lib/crypto.ts:35-49`). |
| `tryDecrypt` returns null and we fall back (`lib/crypto.ts:59-66`, `lib/email.ts:140-143`) | Throw | A rotated key degrades to "not configured" instead of breaking every send. |
| Cache one `OAuth2Client` per refresh token (`lib/email.ts:151-159`) | New client per send | Reuses the access token and shares an in-flight refresh, so a bulk stage change is not one refresh per lead. |
| Build a fresh SMTP transporter per send (`lib/email.ts:29-35`) | Cache transporters | A cache would keep a stale password after rotation. |
| 10 s SMTP timeouts, 15 s Gmail timeout (`lib/email.ts:42-47`, `:182`) | Library defaults | nodemailer can hang up to 10 min on a blocked port. |
| Per-user limit 20/hour, org limit 200/hour on custom recipients (`app/api/email/send/route.ts:19-28`, `:80-89`) | Per-IP | Stops one account becoming a spam relay without throttling a shared office IP. |

## 3. Malicious actors

| Actor | What they try | What stops them | Residual risk |
|---|---|---|---|
| Anonymous visitor | Call send or settings routes | `requireApiUser` returns 401 (`app/api/email/send/route.ts:16-17`, `app/api/settings/email/route.ts:15-16`, `start/route.ts:27-28`, `callback/route.ts:13-14`). The proxy also requires a session for `/api/*` (`proxy.ts:93`, `:117-119`). | None found. |
| Invitee (new member) | Send as someone else | `sendEmailAs` always gets `user.id` from the session (`app/api/email/send/route.ts:54`, `:91`). | None found. |
| Sales rep | Email a lead they don't own | Lead lookup uses `findFirst` with `leadScope(user)`, which adds `ownerId` for sales (`app/api/email/send/route.ts:49-52`, `lib/session.ts:182-186`). Returns 404. | None found. |
| Sales rep | Send spam to any address | Address must be valid (`send/route.ts:77-79`); 20/hour per user, 200/hour per org (`:22`, `:83`); audit row per send (`:92`). | By design any member may email any address, through the org SMTP mailbox if they have no Gmail. Audit keeps only `to`, not subject or body. The org cap does not apply to lead-scoped sends. Limits are in-memory and reset on deploy (`lib/rateLimit.ts:3-9`). |
| Sales rep | Inject headers (e.g. `Bcc:`) | CR/LF flattened in From/To/Subject; subject RFC 2047 encoded (`lib/email.ts:114-123`). nodemailer builds the SMTP message (`lib/email.ts:53`). | Body is not escaped, but it sits after the header block, so it cannot add headers. |
| Sales rep | Change org SMTP settings | `isAdmin` check, 403 (`app/api/settings/org-email/route.ts:15`, `:27`, `:114`). | None found. |
| Admin (own org) | Read the stored SMTP password | GET never selects `smtpPassEnc` (`org-email/route.ts:17-20`). | **Gap.** Re-saving without a password skips `verify()` (`:63-69`) but keeps the old password (`:101`). An admin can point `smtpHost` at their own server and trigger a send to capture the password a previous admin set. |
| Admin (own org) | Probe internal hosts | None. Any `smtpHost`/`smtpPort` is accepted and `verify()` connects to it (`org-email/route.ts:32-33`, `:67-68`). | **Gap.** Admin-only SSRF/port probe. The error is generic (`:77-80`), but timing may differ. |
| Admin of another org | Read or overwrite this org's mailbox | Every org-email query keys on `user.orgId` from the session (`org-email/route.ts:18`, `:58`, `:84`, `:116`). Personal Gmail routes key on `user.id` (`app/api/settings/email/route.ts:17-18`, `:30-31`, `callback/route.ts:54-55`). | None found. |
| Holder of a leaked link/token | Replay a Google `code` | Needs the matching state cookie (`callback/route.ts:30-32`) and our client secret (`:35-40`). Google codes are single-use (Google behaviour, unverified here). | None found. |
| Holder of a leaked link/token | Use a DB dump of `gmailRefreshTokenEnc` / `smtpPassEnc` | Ciphertext needs `CREDENTIAL_ENCRYPTION_KEY` (`lib/crypto.ts:9-23`). | No AAD binds ciphertext to a row, so someone with DB write access could swap tokens between users. No key version, so rotation means everyone reconnects. |
| Tampering with OAuth callback state | Bind the attacker's Gmail to a victim (login CSRF) | Random 16-byte `state` (`start/route.ts:40`), stored in an `httpOnly`, `sameSite=lax`, path-scoped, 10-minute cookie (`:56-63`), compared on return (`callback/route.ts:32`). Cookie cleared on every exit (`:22-28`). Tested in `callback/route.test.ts:54`, `:61`. | State is not tied to the user id, but the cookie lives in the victim's own browser, so a forged link fails. Plain `!==` compare, not constant-time; low risk for a one-time random value. |

## 4. Data structures

| Item | Where | Why this shape |
|---|---|---|
| `User.emailFromAddress` | `prisma/schema.prisma:394` | The Google account email from the ID token (`callback/route.ts:51`, `:57`). Used as the From header (`lib/email.ts:181`). |
| `User.gmailRefreshTokenEnc` | `prisma/schema.prisma:395` | Encrypted refresh token, never returned to the client (`app/api/settings/email/route.ts:17-24`). Cleared on `invalid_grant` (`lib/email.ts:169-173`) and on disconnect (`app/api/settings/email/route.ts:30-33`). |
| `User.emailConfiguredAt` | `prisma/schema.prisma:396` | Drives "connected" in Settings (`app/api/settings/email/route.ts:23`). Cleared with the token. |
| `OrgEmailConfig` (`orgId` unique) | `prisma/schema.prisma:72-85` | One mailbox per org; `upsert` on `orgId` (`org-email/route.ts:83-84`). |
| `OrgEmailConfig.smtpPassEnc` | `prisma/schema.prisma:80` | Same `iv:tag:ciphertext` format (`lib/crypto.ts:25-33`). |
| `OrgEmailConfig.smtpSecure` default true | `prisma/schema.prisma:78` | Caller must send `false` for STARTTLS on 587 (`org-email/route.ts:34`). The global mailbox derives it from port 465 (`lib/email.ts:67`). |
| `gmail_oauth_state` cookie | `lib/email.ts:8`, `start/route.ts:57-63` | Path `/api/settings/email/oauth`, so no other route sees it. `secure` only in production. |
| In-memory `gmailClients` map | `lib/email.ts:110-112` | Keyed by plaintext refresh token; a reconnect gets a new key. |
| `AuditLog` `custom_email_sent` | `app/api/email/send/route.ts:92`, `prisma/schema.prisma:549-563` | Only the custom-recipient path is audited; lead sends become an `Activity` instead. |

## 5. Where it fails

| Failure | What the user sees | How we notice |
|---|---|---|
| State mismatch, consent denied, scope unticked, no refresh token | Settings with `gmailError=1` banner (`callback/route.ts:32-33`, `:46-48`, `EmailSettingsCard.tsx:21`) | Nothing logged for these exits. |
| Token exchange or ID token check throws | Same banner | `console.error('settings/email/oauth/callback: token exchange failed')` (`callback/route.ts:64`). |
| Google client env missing | Same banner (`start/route.ts:30-38`, `callback/route.ts:37`); sends fall back to SMTP (`lib/email.ts:145-149`) | Nothing logged. |
| Session expired between start and callback | Raw 401 JSON from `requireApiUser` (`callback/route.ts:13-14`), unless the proxy redirects first (unverified which wins). | None. |
| Redirect URI built from `req.url` (`start/route.ts:22`, `callback/route.ts:39`) | If Render's `req.url` host differs from the registered URI, Google refuses. | Unverified behind Render's proxy. |
| Refresh token revoked | That send falls back to org/global SMTP from a different address (`lib/email.ts:161-175`); connection cleared so Settings shows "not connected". | `console.error('[email] Gmail token refresh failed')` (`:166`). |
| Other refresh error (network) | Falls back for this send; connection kept (`lib/email.ts:169`). | Same log. |
| Gmail API returns non-2xx | No fallback: throws (`lib/email.ts:184-186`); user gets 502 "Could not send the email" (`send/route.ts:68-71`, `:94-97`). | `console.error('sendEmail ... failed')` with Google's error text. |
| Fallback reaches SMTP on Render | Connection times out after 10 s (`lib/email.ts:45-47`), then 502. The comments say SMTP is blocked there (`lib/email.ts:130-132`). | Same log. Users without Gmail effectively cannot send in production (inferred from those comments; unverified live). |
| Global SMTP env missing | Throws "SMTP is not configured" (`lib/email.ts:59-63`), then 502. | Same log. |
| Key rotated | All stored credentials decrypt to null and silently fall back (`lib/crypto.ts:59-66`). | No log. |
| Workflow send fails | Rule records a "failed" note instead of "Sent" (`lib/workflow.ts:107-109`). | Lead activity. |

Accepted limits (`shortcut:` comments): the Gmail client cache is per-process and never evicted except
on a failed refresh. Fine at tens of users; needs an LRU at thousands (`lib/email.ts:110-111`).
