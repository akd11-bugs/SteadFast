# Defence brief: Google Sheet lead sync and sync review

## 1. What it does

An org admin shares a Google Sheet with the one deployment-wide service account and pastes its ID in Settings (`app/api/settings/org-sheet-connector/route.ts:38-109`). Every 15 minutes a GitHub Actions job calls the sync endpoint (`.github/workflows/sync-leads-sheet.yml:8,17-20`). For each org with an enabled connector, the endpoint reads the sheet, maps headers to lead fields, and creates a lead for each new row past a saved row cursor (`app/api/cron/sync-leads-sheet/route.ts:30-147`). Duplicates are skipped. A Status/Stage value that matches no pipeline stage still creates the lead as `new` and records an issue (`lib/leadImport.ts:263-290`). Note: review is **after** the import, not before. Leads are already live when an admin or operations user opens "Review sync issues" (`app/settings/ops/[jobRunId]/review/page.tsx:15-44`). There they see skipped rows and unmapped stages, with an AI-suggested stage (`app/api/jobs/[jobRunId]/issues/route.ts:46-68`). They then acknowledge each row or apply a stage (`app/api/jobs/[jobRunId]/issues/[issueId]/resolve/route.ts:41-85`).

## 2. Why X instead of Y

| Decision | Rejected alternative | Why |
|---|---|---|
| One shared service account for every org (`lib/googleSheets.ts:16-40`) | Per-org OAuth or GCP credentials | Admin setup is just "share with this email". The trade-off is that every connected sheet is readable by the same identity (see section 3). |
| Static Bearer key, compared in constant time (`route.ts:182-191`, `lib/http.ts:20-25`) | Session auth | The caller is an unattended cron with no browser. `safeEqual` avoids leaking the key through response timing. |
| GitHub Actions schedule (`sync-leads-sheet.yml:4-9`) | An in-app scheduler | No worker process needed. Accepted cost: GitHub can run late, and pauses schedules after 60 days of repo inactivity (`yml:5-7`). |
| Row-count cursor in `SyncCursor` (`route.ts:60-62,131-135`) | Re-scan and re-dedupe the whole sheet each run | Cheap. It assumes rows are only appended (see section 5). |
| Import first, review after (`lib/leadImport.ts:277-290`) | Hold rows until a human approves them | A bad stage never blocks a lead. Problems persist as `JobRunIssue` rows (`lib/leadImport.ts:300-308`). |
| Gemini suggests lazily when the review screen opens (`issues/route.ts:17-22`) | Calling the AI inside the sync | Keeps the cron fast. A suggestion is cached once made (`issues/route.ts:57-62`). |
| Resolve goes through `applyStageChange` (`resolve/route.ts:14-21,73-78`) | A raw `prisma.lead.update` | Same Activity log and workflow rules as every other stage change. |
| Shared `importLeadRows` for CSV and sheet (`lib/leadImport.ts:63-65`) | Separate importers | Both paths keep identical validation and dedupe. |
| Concurrent per-org sync with `Promise.all` (`route.ts:199-202`) | Running orgs one after another | Each org has its own cursor. `syncOneSheet` catches its own errors (`route.ts:142-146`). |

**Dedupe rules** (`lib/leadImport.ts:149-213`): a row is a duplicate if it has the same email as a lead in the org (case-insensitive), the same contact name at the same company, or, when it has no email and no contact, the same company as an existing bare lead. Each rule is checked against the database and against earlier rows in the same batch. A row with no company, or with an invalid email, is skipped (`lib/leadImport.ts:109-117`).

**Mapping:** fixed fields come from `autoMapHeaders`, and leftover columns go to the org's custom fields (`route.ts:44-54`). An owner column is matched by name or email inside the org, with the connector's default owner as fallback (`route.ts:11,55-58,74-89`).

## 3. Malicious actors

| Actor | What they can try | What stops them |
|---|---|---|
| Anonymous visitor | Call the cron endpoint | Gets 401 without the key (`route.ts:187-191`). Gets 503 if the key is unset (`route.ts:183-186`). |
| Anonymous visitor | Open the review or issues APIs | `requireApiUser` (`issues/route.ts:24-25`, `resolve/route.ts:29-30`). |
| Sales rep | Read or resolve issues | 403. Only admin or operations can review (`issues/route.ts:13-15,26`, `resolve/route.ts:10-12,31`). |
| Sales rep | Configure the connector | 403. Admin only (`org-sheet-connector/route.ts:29,41,114`). |
| Admin of another org | Read our job run or issues by guessing the id | `findFirst` with `orgId in visibleOrgIds`, and 404 if not found (`issues/route.ts:33-37`, `resolve/route.ts:35-38,67-71`). `visibleOrgIds` is only the user's own org (`lib/session.ts:35-37`). |
| Admin of another org | Bind our sheet to their org | `sheetId @unique` (`prisma/schema.prisma:107`) gives a 409 (`org-sheet-connector/route.ts:104-106`). Probing is capped at 20 per hour (`route.ts:16,43-49`), but the limiter is in memory and per process (`lib/rateLimit.ts:3-16`). |
| Admin of another org | Set a default owner from our org | The owner must be in their own org (`org-sheet-connector/route.ts:70-73`). |
| Someone who can edit the connected sheet | Inject rows | Rows land only in the connector's org (`route.ts:121`, `lib/leadImport.ts:264-275`). The owner column only resolves users in that org (`route.ts:79-85`). |
| Sheet editor | Prompt-inject Gemini through a stage cell | The output must be one of the org's stage keys (`lib/stageSuggest.ts:92-94`). A human still picks the stage, and the server re-validates it (`resolve/route.ts:62-65`). |
| Holder of a leaked cron secret | Trigger syncs at will | The request has no body or params. It can only run the normal sync for all orgs (`route.ts:193-202`). There is no rate limit on this route. |

**Residual risks (known, unfixed):**
- ~~Sheet uniqueness could be bypassed~~ **Fixed in Phase 1.** A value like `<victimId>/values/A:Z?x=` used to pass the `@unique` check yet rewrite the Google API path. Now the route rejects anything but `[A-Za-z0-9_-]{10,100}` (`app/api/settings/org-sheet-connector/route.ts:69`, `SHEET_ID_PATTERN` in `lib/googleSheets.ts:44`), and every API call re-checks and URL-encodes the id (`sheetPath`, `lib/googleSheets.ts:45-48`). Tested: `lib/googleSheets.test.ts`. A row already saved with a bad id now fails its sync loudly instead of reading another sheet.
- **Any sheet shared with the service account but not yet claimed can be connected by any org admin who knows its ID** (`org-sheet-connector/route.ts:82-98`). This includes a sheet whose own org has disconnected it (`route.ts:116`).
- **A leaked cron secret exposes cross-org data.** The response returns every org's skip reasons, which contain lead emails, contact names and companies (`lib/leadImport.ts:186-206`, `route.ts:123-125,204`). It also returns raw error strings (`route.ts:145`). The GitHub workflow used to print this response into Actions logs; since Phase 1 it prints counts only (`.github/workflows/sync-leads-sheet.yml`, the `jq` step). The response itself still carries skip reasons, so a leaked key still exposes them.
- **Concurrent calls can create duplicates.** There is no lock, and `Lead` has no unique email index (`prisma/schema.prisma:364-373`). Two overlapping runs read the same cursor and both pass dedupe.
- **A sheet editor can set any stage**, including `onboarding`, at creation. That uses a direct `lead.create` (`lib/leadImport.ts:264-275`), so `wonAt` and ops assignment are not set and workflow rules do not fire.
- ~~Formula injection from the public form~~ **Fixed in Phase 1.** Appended cells starting with `= + - @`, tab or CR get a leading apostrophe, so Sheets stores them as text (`sheetSafeCell`, `lib/googleSheets.ts:52-54`, applied at `:81`). Side effect: a phone like `+91…` is stored as text too, which is what we want. Tested: `lib/googleSheets.test.ts`.
- **Raw stage values are sent to Google Gemini** (`lib/stageSuggest.ts:30-41,71`).

## 4. Data structures

| Table / field | Shape and why |
|---|---|
| `OrgSheetConnector` (`schema.prisma:99-114`) | One per org: `orgId @unique` (`:101`). `sheetId @unique` across all orgs, so a second org cannot claim a sheet (`:103-107`). `defaultOwnerUserId` is a plain string with no foreign key (`:109`), so a deleted owner makes the sync skip that org (`route.ts:164`). `enabled` defaults to true (`:110`); no route sets it to false, and disconnecting deletes the row (`org-sheet-connector/route.ts:116`). `lastSyncedAt` (`:111`) is updated after a successful run (`route.ts:136`). |
| `SyncCursor` (`schema.prisma:565-573`) | A generic key/value store. `key @unique` (`:570`) is `leads-sheet:org:<orgId>` (`route.ts:168`). `value` is a string holding the count of data rows already processed (`route.ts:133`). |
| `JobRun` (`schema.prisma:578-590`) | One row per run. `orgId` is nullable for older global jobs (`:580`). Indexes on `[jobKey, finishedAt]` and `[orgId, finishedAt]` (`:588-589`) support the Ops "last run" view (`app/settings/ops/page.tsx:35-39`). The run is created first with a placeholder status of `success` (`lib/jobRun.ts:33-44`), so issues can attach mid-run. |
| `JobRunIssue` (`schema.prisma:600-620`) | A separate table, not a JSON blob, so each row can be resolved on its own (`:592-599`). `kind` is `skip` or `stage_unmapped` (`:606`). `leadId` is set only for `stage_unmapped`, with `onDelete: SetNull` (`:609-610`). `suggestedStage` and `suggestionConfidence` hold the AI suggestion, which is advisory only (`:611-612`). `resolvedStage`, `resolvedBy` and `resolvedAt` record who fixed what (`:613-615`). It cascades when its `JobRun` is deleted (`:603`). Indexes on `[jobRunId]` and `[orgId, resolvedAt]` (`:618-619`). |

## 5. Where it fails

| Failure | What the user sees | How we notice |
|---|---|---|
| Sheet not shared, or wrong ID, at setup | A clear 400 message naming the service account email (`org-sheet-connector/route.ts:82-90`) | Server log (`:85`) |
| Sharing removed later, or Google API error | No new leads. That run is marked failure (`route.ts:142-145`) | Ops page shows a `failure` badge but not the error text (`app/settings/ops/page.tsx:106,135-137`). The error is in `JobRun.error` and the server log (`route.ts:144`). The workflow fails only on HTTP ≥400 (`yml:23-25`), and per-org failures still return 200 (`route.ts:204`), so GitHub stays green. |
| Default owner deleted | That org silently stops syncing (`route.ts:164`) | No `JobRun` is written. Only a stale `lastSyncedAt` shows it. |
| Rows inserted, deleted or sorted above the cursor | New rows are skipped, or old rows re-imported (`route.ts:61-62`) | Re-imports mostly show up as `skip` duplicate issues. Missed rows are not noticed. |
| Crash partway through a run | Leads created so far stay. The cursor does not advance (`route.ts:131` is after the import loop) | The next run re-reads those rows. Dedupe drops most of them, and duplicate `skip` issues appear. |
| `startJobRun` throws (DB down) | It runs outside the `try` (`route.ts:35`), so `Promise.all` rejects and all orgs fail with a 500 | The GitHub workflow fails (`yml:23-25`). |
| Gemini key unset or call fails | No suggestion. The row can still be resolved by hand (`issues/route.ts:64-65`, `lib/stageSuggest.ts:57-60`) | None needed. |
| Very large sheet | Rows are created one at a time (`lib/leadImport.ts:246-248`). There is no row cap. | Request timeout behaviour is unverified. |
| Operations user wants to find issues | The Ops page is admin only (`app/settings/ops/page.tsx:29`), but the review page allows operations (`review/page.tsx:17`) | Operations users need a direct link. |

**Accepted limits:** GitHub schedule drift and its 60-day pause (`yml:5-7`). Leads written back from other create paths, which append once with `USER_ENTERED` and are never updated (`lib/googleSheetWriteback.ts:5-13`, `lib/googleSheets.ts:63`). There are no `shortcut:` comments in this feature's code.
