# Spec: configurable record engine (blank canvas, templates, views, automations, notifications)

Status: draft for review · 2026-11-22 · branch `development`

## Why

The product was built for one company's B2B sales + onboarding flow and then re-branded. The goal now is a
true white-label CRM that companies in any sector (e-commerce, fashion, logistics, operations…) can shape
themselves: start from a blank canvas or a template, define their own objects and fields, view the same data
several ways, automate it, and get notified.

Decisions taken (2026-11-22):

| Question | Decision |
|---|---|
| Migration | Build the engine **alongside** today's Lead model. Today's product becomes the "B2B Sales & Onboarding" template; orgs move over screen by screen; old tables are removed last. |
| Ops panel | Sales records get **"Hand off to onboarding team"**. The onboarding team has its **own pipeline, customisable by that team**, and assigns one of its members. |
| Order | Engine first. White-label (old Phase 2) and the visual redesign (old Phase 3) are done once, on the new screens. |
| Out of scope now | Third-party integrations (Slack, Outlook, etc.), mobile push, formula/lookup fields. |

## 1. Data model

| Table | Fields (all carry `orgId`) | Notes |
|---|---|---|
| `ObjectType` | `key`, `name`, `icon`, `templateKey?`, `teamId?`, `position` | "Deals", "Orders", "Onboardings". `teamId` = owning team (who may edit its schema). |
| `Field` | `objectTypeId`, `key`, `label`, `type`, `config` (JSONB: options/colours, currency, target object), `required`, `position` | `@@unique([objectTypeId, key])`. Status options carry `isWon`/`isLost`/`isFinal` flags for reports. |
| `Record` | `objectTypeId`, `values` (JSONB), `createdById`, `ownerId?`, timestamps | GIN index on `values`; `@@index([orgId, objectTypeId, updatedAt])`. |
| `RecordLink` | `fromRecordId`, `toRecordId`, `fieldId` | Both ends must share `orgId` (checked in code and by test). |
| `Team` / `TeamMember` | `name`; `userId`, `role` (`member` / `lead`) | Team leads may edit their object's fields, statuses and views, and assign members. |
| `View` | `objectTypeId`, `type` (`table`/`kanban`/`calendar`), `filters`, `sorts`, `groupByFieldId?`, `dateFieldId?`, `columns`, `visibility` (`org`/`team`/`private`), `createdById` | Replaces `SavedView`. |
| `Comment` | `recordId`, `authorId`, `body`, `mentions` (userId[]) | The "updates" thread on a record. |
| `Event` | `type`, `recordId?`, `payload`, `depth`, `processedAt?`, `attempts` | Outbox. Written in the same transaction as the change. |
| `Automation` / `AutomationRun` | `objectTypeId`, `trigger` (JSONB), `conditions` (JSONB), `actions` (JSONB), `enabled`, `createdById`; run: `eventId`, `status`, `error` | Replaces `WorkflowRule`. |
| `Notification` / `NotificationPreference` | `userId`, `type`, `recordId?`, `payload`, `readAt?`; pref: `type`, `channel` (`in_app`/`email`/`digest`/`off`) | |
| `Template` | `key`, `name`, `sector`, `version`, `definition` (JSONB), `orgId?` (null = built-in) | Bundle of objects, fields, views, automations, sample records. |

**Field types v1:** text, long text, number, currency, date, status, select, multi-select, person, link-to-record,
email, phone, URL, checkbox, file. Later: formula, lookup (mirror), rating, location.

### Why JSONB values (whiteboard defence)
- *Table per object*: a migration every time a customer adds a field — impossible multi-tenant.
- *EAV row per value*: every list query becomes a join per column; complex and slow.
- *JSONB + `Field` definitions*: one row per record, GIN-indexed equality filters, no migrations. Cost: range
  filters/sorts on JSON are slower. `shortcut:` acceptable to ~100k records per object per org; beyond that add
  per-field expression indexes or a typed side table.

### Security invariants
1. Every query goes through one `recordScope(user, objectTypeId)` (the `leadScope` of the engine).
2. Filter/sort/group keys must exist in that org's `Field` table; values are bound parameters. No client string
   ever reaches raw SQL.
3. Values are validated against the field type on every write (server-side; the UI is not trusted).
4. Schema edits (fields, statuses, views with `org` visibility) need org admin or the owning team's lead.
5. `RecordLink` ends and `person` values must belong to the same org.

## 2. Views

One query layer (`queryRecords(scope, view, page)`) feeds every renderer. A record list page shows the object's
views as tabs; switching tabs keeps the same filter bar. Kanban groups by a status field (drag = status change,
which emits an event); Calendar places records by a date field. Today's Leads table, Pipeline and Calendar
become renderers of this.

### Pipelines and charts are fields, and editable
- A **pipeline = a status field**. Its options are the stages: add, rename, recolour, reorder, mark won/lost/final.
  Kanban columns and every chart follow the field instantly. Deleting a stage that holds records asks where to
  move them first. An object may have several status fields; each Kanban view picks one.
- **Dashboards are configurable.** `Dashboard` (org or private) has `Widget`s: `type` (bar, funnel, number,
  progress) + JSONB `config` = `{ objectTypeId, groupByFieldId, measure: count | sum/avg(fieldId), filters }`.
  Users add, edit in place, remove and reorder widgets. Each template ships a default dashboard.
- Bars are generated from the field's own options, so a new stage can never be silently dropped (the earlier
  funnel bug). Widget keys pass the same field allowlist as views, and every number is computed through
  `recordScope`, so a sales rep's chart totals cover only records they may see.

## 3. Hand-off to onboarding (ops panel)

- The B2B template creates two objects: **Deals** (sales pipeline) and **Onboardings** (owned by the
  "Onboarding" team, its own status pipeline, linked to a Deal).
- A Deal shows **"Hand off to onboarding team"** (also usable as an automation action, e.g. "when status
  becomes Won"). It creates an Onboarding record linked to the Deal, unassigned, and notifies the team's leads.
- The onboarding team's view: their queue (unassigned → assign a member), their pipeline (Kanban), overdue
  items. Team leads edit their own statuses/fields without org-admin rights.
- Generic, not hard-coded: any org can mark an action "Hand off to <team>" between any two objects.

## 4. Automations

- **Triggers:** record created · field changed · status changed to X · date field reached · no activity for N
  days · schedule (daily/weekly).
- **Conditions:** the view filter language.
- **Actions:** update field · create linked record · hand off to team · assign (round-robin within a team) ·
  notify user/team · send email (existing Gmail/SMTP sender) · webhook (existing).
- **Execution:** every write appends an `Event` in the same transaction (outbox). A worker claims events with
  `SELECT … FOR UPDATE SKIP LOCKED`, evaluates matching automations, writes `AutomationRun`, retries up to 3
  times with backoff. Time-based triggers are produced by a scheduler tick.
- **Runs on:** a cron caller hitting `/api/cron/process-events` every minute (same Bearer-key pattern as the sheet
  sync). `shortcut:` minute latency; upgrade to a Render background worker when customers need seconds.
- **Loop guard:** events caused by an automation carry `depth + 1`; depth > 3 is dropped and logged.
- Why not Redis/BullMQ: nothing new to run or pay for, the volume is small, and the outbox gives
  exactly-once-per-commit semantics that a separate queue would not.

## 5. Notifications and the daily admin email

- Sources: @mention in a comment, assignment, hand-off, automation "notify", system failures (sync, email).
- In-app bell with unread count (poll 30 s; SSE later). Notification centre with mark-read.
- Email channel per preference (instant for mentions/assignments by default).
- **Daily digest:** the existing `/api/cron/daily-activity-report` (GitHub Actions schedule) becomes the digest
  job: per org → per user whose preference is `digest` → unread notifications + a summary computed from that
  org's own objects (records created, status moves, overdue). Admins get the org summary by default.
- "Push" = email for now. Browser/mobile push is out of scope.

## 6. Templates and blank canvas

- Signup wizard step: **Blank** or a template. Built-in v1: B2B Sales & Onboarding (today's product), E-commerce
  Orders, Fashion Wholesale, Logistics / Shipments, Recruiting.
- Applying a template copies its definition into the org; later template versions never change an org
  silently.
- "Save as template" exports the org's objects/fields/views/automations (no data).

### Template format (adding one later = adding one JSON file)
- One versioned JSON document: `key`, `name`, `sector`, `version`, `teams[]`, `objects[]` (each with `fields[]`,
  `views[]`, `automations[]`), optional `sampleRecords`.
- Everything inside references other parts **by key, never by id** (`"target": "customers"`,
  `"groupBy": "status"`, `"team": "fulfilment"`); keys resolve to real ids at apply time.
- Built-in templates live in `templates/*.json`, are loaded into `Template` by key+version on deploy, and appear in
  the signup picker automatically. No code change, no migration.
- **Validation (CI + unit test):** known field types only; every `target`/`groupBy`/`dateField`/`team` resolves
  inside the same file; unique keys; only real triggers/actions. A test applies every template to an empty org.
- **Apply** runs in one transaction: teams → objects → fields → links → views → automations → sample records.
- **Versioning:** a change is a new version; orgs keep the version they started from. Opt-in upgrades are later.
- "Save as template" emits this same format, so customer and built-in templates share one validator.

## 7. Migration of existing orgs

1. Engine tables land; nothing reads them.
2. A migration script maps each org: `StageDefinition` + `PendingSubStatusDefinition` → Deal status options;
   `LeadFieldDefinition` → Fields; Lead+Company+Person → Records with links; Activity → Comments/activity
   events; onboarding sub-stages + documents → Onboardings object. Idempotent and re-runnable on the Docker DB.
3. Screens switch one at a time behind a per-org flag; the old tables stay read-only until every org has moved.
4. Old-only features are rebuilt on records or kept as template features: rep PIN pages, card scan, sheet sync,
   intake forms, the 30 skills, MCP/agent API.

**Promises to current users (acceptance criteria):**
- Nothing changes for an org until it is migrated; fixes keep shipping on the current screens meanwhile.
- Orgs move one at a time, by us, after a rehearsal on a copy of their data (Docker DB) with record counts and
  report totals ("won this month", funnel) matching before vs after.
- The migration script is idempotent; a per-org flag switches screens; flipping it back is the rollback and the
  old tables stay untouched (read-only) until every org has moved.
- An org moves only when every feature it uses exists on the engine (no regressions).
- Logins, roles, history, custom stages/fields, rep PIN pages, intake forms, sheet sync and email keep working.
- Old URLs (`/leads/<id>`, `/pipeline`, …) redirect to the new record/view pages.
- The agent REST API and MCP lead endpoints stay as a compatibility layer over Deal records until API users have
  had notice.
- Each org admin gets a "what's new" note before their move.

## 8. Build order (each step: own commit(s) on `development`, defence brief, tests)

1. Engine core: objects, fields, records, links, validation, `recordScope`, query layer, Table view, settings
   UI to add objects/fields.
2. Views: Kanban + Calendar tabs, saved/shared views; editable status fields (pipelines); configurable
   dashboard widgets.
3. Teams + hand-off + onboarding pipeline.
4. Templates + blank-canvas signup + 4 sector templates; migration script for existing orgs.
5. Notifications: comments/@mentions, bell, preferences, digest email.
6. Automations: outbox, worker, rule builder UI, retire `WorkflowRule`.
7. White-label (per-org name/logo/colour) and visual redesign on the new screens.

## Open questions
- Per-record permissions (e.g. sales sees only own deals) are today's `ownerId` rule. Keep as an object setting
  "members see only records they own", or full role/permission matrix later?
- Volume target per org (records, users) to confirm the JSONB `shortcut:` is safe.
