# Defence briefs

One brief per customer-facing system. Each answers the same five questions, in order:

1. **What it does** — the behaviour a customer sees.
2. **Why X instead of Y** — each real decision and the alternatives we turned down.
3. **Malicious actors** — who can try what, and the `file:line` that stops them. Known gaps are listed, not hidden.
4. **Data structures** — the tables, fields, cookies and tokens, and why each has its shape.
5. **Where it fails** — failure modes, what the user sees, how we'd notice, and accepted limits (`shortcut:` comments).

Every claim cites code. If the code changes, the brief changes in the same commit.

| System | Brief |
|---|---|
| Tenancy, `leadScope`, roles, rep slug auth | [tenancy.md](tenancy.md) |
| Invites and moving an account between workspaces | [invites.md](invites.md) |
| Sign-in, sign-up, sessions, password reset, dev login | [auth.md](auth.md) |
| Sending email (Gmail OAuth, SMTP fallback) | [gmail-sending.md](gmail-sending.md) |
| Google Sheet sync and its review step | [sheet-sync.md](sheet-sync.md) |
| Workflow rules | [workflow-rules.md](workflow-rules.md) |

## Phase 1 changes (stability and security)

| Change | Why | Where |
|---|---|---|
| Lead detail page looks up by `id` **and** `leadScope` | An admin could open another org's lead by URL | `app/leads/[id]/page.tsx:15-17` |
| "Reassign to" list filtered by org | It listed users from every org | `app/leads/page.tsx` owners query |
| Email-domain auto-join removed | A shared domain is not consent; one outsider invite opened the org to their whole domain | `lib/session.ts` `resolveSession` |
| Sheet id validated and encoded | A crafted id could read another org's sheet | `lib/googleSheets.ts:44-48` |
| Formula-leading cells escaped on write-back | Anonymous visitors could plant formulas in a customer's sheet | `lib/googleSheets.ts:52-54` |
| Sync log prints counts only | Actions logs printed lead emails every 15 min | `.github/workflows/sync-leads-sheet.yml` |
| Rep PIN cleared on workspace move | The old admin knew it | `app/api/invites/redeem/route.ts` |
| Company view's leads follow `leadScope` | Sales reps could read other reps' leads through a company | `app/api/companies/[id]/route.ts` |
| Activity `type` allowlisted, `date` validated | Clients could forge `stage_change` / `onboarding_step` entries that reports count | `app/api/activities/route.ts` |
| Custom stage can't be deleted while it holds leads | Its leads vanished from every column | `app/api/pipeline-config/stages/[id]/route.ts` |
| Deactivated users never receive intake/sync leads | Leads landed on people no one sees | `lib/publicLeadIntake.ts`, sync `resolveOwner` |
| Email send: a logging failure after sending returns ok | "Try again" made users send twice | `app/api/email/send/route.ts` |
| Failed saves, deletes, task ticks and loads now say so | They silently looked like success | `LeadRecordView`, `LeadTasksTab`, `TasksList`, `LeadDetailDialog`, `ActivityFeed` |

## Open, not yet fixed (next batch)

- **Rate limits trust the first `X-Forwarded-For` entry** (`lib/rateLimit.ts:52-55`), so they can be dodged. The fix depends on how Render's proxy chain builds that header; it must be confirmed before changing, or every user could end up sharing one limit.
- **Stage invariants skipped on some paths:** lead create, sheet import, sync-review resolve and the agent API can put a lead in `onboarding` with no ops person or `wonAt`, or in `pending` with no sub-status.
- **Bulk "move to Onboarding" always fails**: the table never sends `assignedOpsId`.
- **Sync-review shows the wrong row numbers** after the first sync.
- **SMTP settings:** an admin can point the host at their own server and receive the password a previous admin saved; any host/port is accepted (SSRF).
- **Invites never expire**; public intake has no duplicate check.
- **Company edit/delete has no role check** (product decision pending).
