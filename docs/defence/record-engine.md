# Defence brief: record engine, step 1 (objects, fields, records, table view)

Branch `development`, 2026-11-23. Spec: `docs/specs/record-engine.md`. Paths are
relative to the repo root; check line numbers with `grep` before you quote them.

## 1. What it does

An org admin defines their own kinds of records ("Orders", "Shipments") under
Settings → Objects, and gives each one fields of 14 types: text, long text,
number, currency, date, status, select, multi-select, person, link to another
record, email, phone, URL and checkbox. Status options can be marked Won or
Lost. Members then work with those records on `/records/<object>`: a table they
can search, sort, filter and page through, a "New record" form generated from the
fields, and a detail page where every field is edited in place. An object can be
set to "members see only records they own". The whole feature is off per org
(`Organization.recordEngineEnabled`) until we switch that org on with
`scripts/record-engine-flag.mjs`. While it is off, every engine page and API
returns 404 and the nav link is hidden. Today's Leads screens are unchanged.

## 2. Why X instead of Y

| Decision | Rejected | Why |
|---|---|---|
| One `ObjectRecord.values` JSONB column keyed by field key, with a GIN index (`prisma/schema.prisma`, model `ObjectRecord`) | A table per object; EAV (one row per value) | A table per object needs a migration every time a customer adds a field, which is impossible across many tenants. EAV turns every list into one join per column. JSONB is one row per record and needs no migrations. Cost: range filters and sorts can't use the GIN index (see section 5). |
| Field and object keys are generated (`makeKey`, `lib/records/fieldTypes.ts`) and never editable; labels are | User-chosen keys | Values are stored under the key, so a rename would orphan data. Templates (step 4) reference keys. |
| Models named `ObjectType`/`ObjectField`/`ObjectRecord` | The spec's `Record`/`Field` | A Prisma model called `Record` would shadow TypeScript's built-in `Record<K,V>` everywhere the client is imported. |
| Link values stored as id arrays inside `values` (`shortcut:` comment in `validateValue`) | A `RecordLink` table now | Fewer moving parts for step 1. Upgrade when backlinks need their own queries at scale. |
| Raw SQL for list queries (`lib/records/query.ts`) | Prisma `findMany` | Prisma can't sort by a JSON path or cast it to numeric. Raw SQL is safe here because keys are allowlisted and every value is bound (section 3). |
| Record edits merge in SQL: `"values" = ("values" \|\| patch) - cleared` (`app/api/records/[id]/route.ts`) | Read, merge in JS, write | Two people editing different fields of one record at once both keep their change. Checked against the local database. |
| "Members see only records they own" is a per-object switch (`ObjectType.restrictToOwner`) | A full permission matrix | It mirrors today's sales rule (`leadScope`) with one boolean. The matrix stays an open question in the spec. |
| A per-org flag, flipped by a script | Shipping to every org at once | Spec section 7: orgs move one at a time and flipping back is the rollback. |
| Schema edits admin-only (`canEditSchema`, `lib/records/scope.ts`) | Team leads too | Teams arrive in step 3. |

## 3. Malicious actors

| Actor | What they try | What stops them |
|---|---|---|
| Anyone signed in to an org with the engine off | Call the APIs or open the pages | `engineUser()` (`lib/records/api.ts`) on every route and `engineEnabled()` on every page return 404. The nav flag is only cosmetic. |
| Member of org B | Read or edit org A's object, field or record by id or key | Lookups are `findFirst` with `orgId` from the session (`findObjectType`, `lib/records/scope.ts`; field and record routes). Not found returns 404, not 403. Tested in `test/recordEngine.test.ts`. |
| Member | Inject SQL through a filter, sort or search | Field keys must exist in the org's own field list before any SQL is built. Values, keys, search text and patches are bound parameters (`Prisma.sql`). Operators and sort direction are fixed fragments. Tested: `filterSql` binds `x"; DROP TABLE` as data (`lib/records/fieldTypes.test.ts`). |
| Sales rep on a "see only own" object | Read, count, search, link to, edit or delete someone else's record | `recordScope` adds `ownerId` for anyone who is not admin or operations. It applies to the list, the `total`, search, the link picker, the detail page, and the PATCH/DELETE SQL. Tested. |
| Member | Make someone else the owner of a record, or take it over | Only admin and operations may set `ownerId`, and it must be an active user in the same org. 403 otherwise. Tested. |
| Member | Write junk or oversized data | `validateValues` runs on every write. Unknown keys are rejected, values are checked per type, text is capped at 500 characters and long text at 20k. There are at most 100 options, 100 links, 200 fields per object, 20 filters and 100 rows per page. |
| Member | Learn whether a record id exists by linking to it | A link to an invisible record and a link to a missing record give the same error (`checkReferences`). |
| Member | Point a person or link field outside the org | `checkReferences` requires the same org and an active user. Link targets must be visible to the caller. |
| Member | Stored XSS | No `dangerouslySetInnerHTML`. URL values must be http or https on the server. Option colours must be `#rrggbb`. Everything else renders as React text. |
| Sales rep | Change the schema (add, delete or edit fields or objects) | `canEditSchema`: admin only, 403. Tested. |
| Admin | Lose data by accident | Deleting an object that still has records returns 409, including a record created mid-delete (`deleteMany ... records: none`). Deleting an object that other link fields target returns 409. Removing an option still in use returns 409 with a count. Deleting a field asks for a confirmation that says it is permanent. |
| Operator running the flag script | Flip production by mistake | The script refuses non-localhost hosts unless `I_MEAN_IT=yes`. It loads `.env.local` **before** importing `@prisma/client`, because the client loads `.env` (production) on import and dotenv never overwrites. This was caught by the guard during development. |

Residual (honest):
- Without "see only own", sales can **edit** other people's records (not delete them). That matches the spec today; whether to tighten it is a product decision.
- A field DELETE racing a record PATCH can write the deleted field's value back into that one record. The value is invisible (unknown key) and is dropped on the next validated write. Not a security issue.

## 4. Data structures

| Item | Shape and why |
|---|---|
| `Organization.recordEngineEnabled` | Boolean, default false. Switches the engine per org. |
| `ObjectType` | `orgId`, `key` (`@@unique([orgId, key])`), `name`, `icon`, `position`, `restrictToOwner`. |
| `ObjectField` | `objectTypeId` (cascade delete), `key` (`@@unique([objectTypeId, key])`), `label`, `type`, `config` JSONB (options with `key/label/color/isWon/isLost`, `currency`, `targetObjectTypeId`), `required`, `position`. Type and key are immutable after creation. |
| `ObjectRecord` | `orgId`, `objectTypeId` (cascade), `values` JSONB, `ownerId`, `createdById`, timestamps. Index `[orgId, objectTypeId, updatedAt]` for the default list order, and GIN `jsonb_path_ops` on `values` for equality and containment filters. |
| Value encoding | Dates are `YYYY-MM-DD` strings, so string order is date order. Status and select hold an option key. Multi-select and link hold arrays. Currency is a number, and the code lives in the field config. |
| Migration | `prisma/migrations/20261123000000_add_record_engine`: additive only (new tables plus one defaulted column). |

## 5. Where it fails

| Failure | What the user sees | How we notice |
|---|---|---|
| Object grows past roughly 100k records | Sorting and range filters slow down (JSON casts can't use the index); search is an ILIKE scan | `shortcut:` comments in `query.ts`. Upgrade: per-field expression indexes or a tsvector column. |
| Linked record deleted | The table shows the raw id instead of a title. Editing the link still works (only newly added ids are checked). | Visible in the UI. There is no cleanup job yet. |
| Table with many link cells | One `GET /api/records/:id` per unseen linked id (cached) | `shortcut:` comment in `components/records`. Upgrade: a batch endpoint. |
| A save fails | The field rolls back and the error text shows. Saves are queued per record, so an older save can't land after a newer one. | User sees it. |
| Engine flag off for an org | 404 on every engine page | Expected. |
| `file` field type | Not offered yet | `shortcut:` comment in `FIELD_TYPES`. It comes with object storage. |

**Tests:** `lib/records/fieldTypes.test.ts` (validation and SQL binding), `lib/records/client.test.ts` (UI helpers), and `test/recordEngine.test.ts` (route tenancy, owner rules, schema guards, transaction on field delete, merge SQL). Not covered by an automated test: the raw SQL against a real Postgres (smoke-tested by hand on Docker only).
