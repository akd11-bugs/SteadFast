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
| Record engine: custom objects, fields, records, table view | [record-engine.md](record-engine.md) |

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

## Audit fixes (2026-11-23)

| Change | Why | Where |
|---|---|---|
| Saved skill run looked up with `findFirst` + org; whole-pipeline runs shown to admin/operations only | `?runId=` used `findUnique` by id: any org could open another org's pipeline analysis, and sales could open admin runs | `app/skills/[skillId]/page.tsx`; `test/tenantIsolation.test.ts` |
| Sheet sync locks per org; workflow has `concurrency:` | Overlapping runs created every new row twice | `app/api/cron/sync-leads-sheet/route.ts` `claimSyncLock`; [sheet-sync.md](sheet-sync.md) |
| Sheet sync rescans when the sheet shrank | Deleting a row made every later new row invisible to the sync | same file, `alreadyProcessed` |
| PIN and password lockouts count atomically before checking | Parallel guesses all read 0, so the lock never triggered | `lib/repAuth.ts`, `lib/loginLockout.ts`; `test/lockout.test.ts` |
| Agent API per-IP limit charged only on a bad key (`peekRateLimit`) | Valid agents were capped at 20 calls per 5 min, shared across orgs behind one IP | `lib/agentAuth.ts`, `lib/rateLimit.ts`; `test/agentAuth.test.ts` |

## Audit fixes, "should fix" batch (2026-11-24)

| # | Change | Why | Where |
|---|---|---|---|
| 6 | Skill runs: 20 per org per hour, question ≤ 2,000 chars, 3 activities per lead, portfolio prompt capped at 200 newest leads and labelled a sample | No ceiling on Anthropic spend; at ~1,500 leads every whole-pipeline run failed "prompt too long" | `app/api/skills/run/route.ts`, `lib/skills/prompts.ts` `PORTFOLIO_LEAD_CAP`; `route.test.ts`, `prompts.test.ts` |
| 7 | MCP connection URLs pass `assertSafeWebhookUrl` on every call; redirects refused | An org admin could make our server probe `10.x`, `169.254.169.254` and read the error | `lib/mcp/connections.ts` `callRemote`; `connections.test.ts` |
| 8 | Rep token carries an HMAC tag of the current `pinHash` | Resetting a lost phone's PIN left its 10 h session alive | `lib/repSession.ts` `pinTag`; `lib/repSession.test.ts` |
| 9 | Lead dialog, command palette and company picker ignore replies for a closed or outdated request | A slow reply for lead A could replace lead B in the dialog, and edits saved to A | `LeadDetailDialog.tsx`, `CommandPalette.tsx`, `CompanyPicker.tsx` (no component test harness; checked by reading) |
| 10 | `lastActivityAt` only moves forward (future dates count as now); report day/week/month boundaries are IST | Logging last week's call made a fresh lead look stale; a deal won 03:00 IST on the 1st counted in the previous month | `app/api/activities/route.ts`; `lib/istDate.ts` used by `reportRange`, `leadFilters`, `dailyReportEmail`, dashboard; `istDate.test.ts` |
| 11 | Sync-issue resolve claims the issue atomically and skips the stage change if the lead left `new` | Resolving an old issue could clear `wonAt` and the ops assignment; a double click logged twice | `app/api/jobs/[jobRunId]/issues/[issueId]/resolve/route.ts`; `route.test.ts` |
| 12 | Onboarding step edits only while the lead is in `onboarding`; a step with leads on it can't be deleted (409); onboarding starts on the org's first step | Sales could mark a `new` lead onboarded; deleting a step stranded leads; deleting `document_submission` broke every new onboarding | `app/api/leads/[id]/route.ts`, `onboarding-steps/[id]/route.ts`, `lib/leadStage.ts`; tests in `tenantIsolation`, `onboarding-steps/[id]/route.test.ts`, `lib/leadStage.test.ts` |
| 13 | `ownerName` no longer accepted on lead PATCH; the field is read-only, admins reassign via bulk (which sets `ownerId` and the name together) | Free text drifted from `ownerId` and credited the wrong rep in reports | `app/api/leads/[id]/route.ts`, `LeadRecordView.tsx` |
| 14 | `xlsx` 0.20.3 from SheetJS's CDN; `nodemailer` 10.6.1 | High-severity prototype pollution / ReDoS in browser import; address-parser bugs | `package.json` |
| 15 | Skill-run and card-scan failures return a generic message; detail goes to the server log | File paths, tracebacks and provider bodies reached the browser | `app/api/skills/run/route.ts`, `app/api/leads/scan-card/route.ts` |
| 16 | Timeouts: Anthropic 60 s × 1 retry, Python 30 s, Google Vision / Language / Sheets 15 s | SDK default could hold a request ~30 min; a hung script never ended; a hung Sheets call could outlive the 10-min sync lock | `lib/skills/runner.ts`, `lib/cardScan/*`, `lib/googleSheets.ts` |
| 17 | SSRF guard blocks `::`, `100.64.0.0/10`, hex-form IPv4-mapped IPv6, and bracketed IPv6 literals | `::` reaches localhost; URL parsing turns `::ffff:127.0.0.1` into `::ffff:7f00:1`, which slipped through | `lib/ssrfGuard.ts`; `lib/ssrfGuard.test.ts` |

Residual: the skill-run limit is in-memory per process (`shortcut:` comment); IST is fixed for every org (`shortcut:` in `lib/istDate.ts`); `better-auth` (under `@neondatabase/auth`) advisories need a breaking Neon Auth upgrade; existing rep sessions are signed out once on deploy (old token format).

## Open, not yet fixed (next batch)

- **Rate limits trust the first `X-Forwarded-For` entry** (`lib/rateLimit.ts:52-55`), so they can be dodged. The fix depends on how Render's proxy chain builds that header; it must be confirmed before changing, or every user could end up sharing one limit.
- **Stage invariants skipped on some paths:** lead create, sheet import, sync-review resolve and the agent API can put a lead in `onboarding` with no ops person or `wonAt`, or in `pending` with no sub-status.
- **Bulk "move to Onboarding" always fails**: the table never sends `assignedOpsId`.
- **Sync-review shows the wrong row numbers** after the first sync.
- **SMTP settings:** an admin can point the host at their own server and receive the password a previous admin saved; any host/port is accepted (SSRF).
- **Invites never expire**; public intake has no duplicate check.
- **Company edit/delete has no role check** (product decision pending).
- **From the 2026-11-23 audit, still open:** items 19–20 (dead code and unused deps; test gaps). Item 18 and the calendar's server-time grid were fixed 2026-11-26. `better-auth` advisories need the Neon Auth major upgrade.
