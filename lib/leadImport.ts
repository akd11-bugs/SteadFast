import { prisma } from '@/lib/db'
import { SOURCES, LEAD_TYPES, BUSINESS_TYPES, isValidWebsite, type LeadSource, type LeadType, type BusinessType } from '@/lib/types'
import { normalizeCompanyName, findOrCreateCompany, findOrCreatePerson } from '@/lib/company'
import { mergeCustomFields } from '@/lib/leadCustomFields'
import { getStageDefinitions } from '@/lib/pipelineConfig'
import { normalizeHeader } from '@/lib/headerMapping'

export interface ImportRow {
  poc?: string
  company?: string
  email?: string
  phone?: string
  website?: string
  industry?: string
  businessType?: string
  source?: string
  type?: string
  estimatedVolume?: string | number
  notes?: string
  // Raw sheet/CSV value from a Status/Stage-like column — unvalidated. Empty
  // or absent is the existing no-op case (defaults to 'new', no issue
  // recorded). A non-empty value that doesn't match a real StageDefinition
  // key/label still creates the lead (defaulted to 'new') but records a
  // JobRunIssue (kind: 'stage_unmapped') so it can be reviewed and corrected
  // later via the sync-review screen.
  stage?: string
  // Admin-defined LeadFieldDefinition values, keyed the same way
  // CustomFieldsSection/mergeCustomFields already expect — populated by
  // autoMapCustomFields() in the CSV dialog and the sheet-sync route when a
  // leftover column's header matches a defined custom field's label.
  customFields?: Record<string, unknown>
}

export interface ImportOwner {
  id: string
  name: string
}

export interface ImportResult {
  created: number
  skipped: { row: number; reason: string }[]
  // Distinct from `skipped`: the lead itself was still created, only its
  // custom-field values (not the fixed fields above) were dropped — e.g. a
  // "Location" column's value didn't match that custom field's defined type.
  customFieldWarnings: { row: number; reason: string }[]
}

function normalizeSource(value: string | undefined): LeadSource {
  const v = (value ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  return (SOURCES as string[]).includes(v) ? (v as LeadSource) : 'other'
}

function normalizeType(value: string | undefined): LeadType {
  const v = (value ?? '').trim().toLowerCase()
  return (LEAD_TYPES as string[]).includes(v) ? (v as LeadType) : 'merchant'
}

function normalizeBusinessType(value: string | undefined): BusinessType | null {
  const v = (value ?? '').trim().toLowerCase()
  return (BUSINESS_TYPES as string[]).includes(v) ? (v as BusinessType) : null
}

// Shared by the CSV import route and the Google Sheets sync cron route — both
// end up with the same shape of loosely-typed rows and need identical
// validation/dedupe/create behavior so they can never quietly drift apart.
//
// `jobRunId` is undefined for the manual-CSV-dialog caller (no JobRun exists
// for that path, and it doesn't need this feature) and set for the cron
// caller — when set, skipped rows and stage_unmapped rows are persisted as
// JobRunIssue rows so they survive past the HTTP response, reviewable later
// from the Ops "needs review" screen.
export async function importLeadRows(
  rows: unknown[],
  owner: ImportOwner,
  orgId: string,
  jobRunId?: string,
): Promise<ImportResult> {
  const skipped: { row: number; reason: string }[] = []
  const customFieldWarnings: { row: number; reason: string }[] = []
  const toCreate: {
    row: number
    poc: string | null
    company: string
    email: string
    phone: string | null
    website: string | null
    industry: string | null
    businessType: BusinessType | null
    source: LeadSource
    type: LeadType
    estimatedVolume: number
    notes: string
    rawStage: string
    customFields: Record<string, unknown>
  }[] = []

  rows.forEach((rawRow, i) => {
    // A stray string/number/null entry (malformed payload) would otherwise
    // throw when we read `row.company` etc. below — skip it like any other
    // invalid row instead.
    if (typeof rawRow !== 'object' || rawRow === null) {
      skipped.push({ row: i + 1, reason: 'Row is not a valid object' })
      return
    }
    const row = rawRow as ImportRow
    const poc = String(row.poc ?? '').trim()
    const company = String(row.company ?? '').trim()
    const email = String(row.email ?? '').trim()
    if (!company) {
      skipped.push({ row: i + 1, reason: 'Missing required company' })
      return
    }
    // Email is optional at import time — can be filled in later on the lead.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push({ row: i + 1, reason: `Invalid email: ${email}` })
      return
    }
    toCreate.push({
      row: i + 1,
      poc: poc || null,
      company,
      email,
      phone: row.phone ? String(row.phone).trim() : null,
      // A mismapped column (e.g. a page title instead of a URL) shouldn't
      // fail the whole row — just drop it, same as a missing email.
      website: row.website && isValidWebsite(String(row.website)) ? String(row.website).trim() : null,
      industry: row.industry ? String(row.industry).trim() : null,
      businessType: normalizeBusinessType(row.businessType),
      source: normalizeSource(row.source),
      type: normalizeType(row.type),
      estimatedVolume: Number(row.estimatedVolume) || 0,
      notes: row.notes ? String(row.notes).trim() : '',
      rawStage: row.stage ? String(row.stage).trim() : '',
      customFields: typeof row.customFields === 'object' && row.customFields !== null ? row.customFields : {},
    })
  })

  // Resolve each distinct company name in the batch to a real Company row
  // once (shared across however many rows reference it), not per-row.
  const companyNames = [...new Set(toCreate.map((r) => r.company))]
  const companiesByNormalizedName = new Map<string, { id: string; name: string }>()
  for (const name of companyNames) {
    const company = await findOrCreateCompany(orgId, name)
    companiesByNormalizedName.set(normalizeCompanyName(name), company)
  }

  const resolvedRows = toCreate.map((r) => ({ ...r, companyId: companiesByNormalizedName.get(normalizeCompanyName(r.company))!.id }))

  // Dedupe: same company is normal (many leads can share one company) — a
  // duplicate is an email match, or the same Person (by name) already
  // existing at that same company, either in the DB or earlier in this file.
  const emails = [...new Set(resolvedRows.filter((r) => r.email).map((r) => r.email.toLowerCase()))]
  const companyIds = [...new Set(resolvedRows.map((r) => r.companyId))]

  const existingLeads = emails.length
    ? await prisma.lead.findMany({ where: { orgId, email: { in: emails, mode: 'insensitive' } }, select: { email: true } })
    : []
  const existingEmails = new Set(existingLeads.map((e) => e.email.toLowerCase()))

  const existingPeople = await prisma.person.findMany({ where: { orgId, companyId: { in: companyIds } }, select: { companyId: true, name: true } })
  const existingPersonKeys = new Set(existingPeople.map((p) => `${p.companyId}::${p.name.toLowerCase()}`))

  // Company-only fallback: a row with neither email nor POC (e.g. a lead-
  // discovery sheet of just company name/industry/source, no contact info)
  // has no per-contact identity to dedupe on, so without this a company
  // mentioned in two source rows (common — press coverage repeats a company
  // across articles) creates a duplicate lead every sync. Only applies when
  // BOTH identifiers are absent — a company legitimately having several
  // named contacts, or several emails, is normal and must still go through.
  const existingBareLeads = await prisma.lead.findMany({
    where: { orgId, companyId: { in: companyIds }, email: '', personId: null },
    select: { companyId: true },
  })
  const existingBareCompanyIds = new Set(existingBareLeads.map((l) => l.companyId))

  const seenEmails = new Set<string>()
  const seenPersonKeys = new Set<string>()
  const seenBareCompanyIds = new Set<string>()

  const finalRows = resolvedRows.filter((r) => {
    const email = r.email.toLowerCase()
    const personKey = r.poc ? `${r.companyId}::${r.poc.toLowerCase()}` : null
    const isBare = !email && !personKey

    if (email && existingEmails.has(email)) {
      skipped.push({ row: r.row, reason: `Duplicate of an existing lead: ${r.email}` })
      return false
    }
    if (personKey && existingPersonKeys.has(personKey)) {
      skipped.push({ row: r.row, reason: `Duplicate of an existing contact: ${r.poc} at ${r.company}` })
      return false
    }
    if (isBare && existingBareCompanyIds.has(r.companyId)) {
      skipped.push({ row: r.row, reason: `Duplicate of an existing lead at: ${r.company}` })
      return false
    }
    if (email && seenEmails.has(email)) {
      skipped.push({ row: r.row, reason: `Duplicate within this file: ${r.email}` })
      return false
    }
    if (personKey && seenPersonKeys.has(personKey)) {
      skipped.push({ row: r.row, reason: `Duplicate within this file: ${r.poc} at ${r.company}` })
      return false
    }
    if (isBare && seenBareCompanyIds.has(r.companyId)) {
      skipped.push({ row: r.row, reason: `Duplicate within this file: ${r.company}` })
      return false
    }
    if (email) seenEmails.add(email)
    if (personKey) seenPersonKeys.add(personKey)
    if (isBare) seenBareCompanyIds.add(r.companyId)
    return true
  })

  // Org-scoped lookup of the real pipeline stages, used below to resolve
  // each row's raw stage text — same exact-then-label matching every other
  // field in headerMapping.ts already uses, case-insensitive via the same
  // normalizeHeader() that file exports. Only fetched once per batch, and
  // only matters when at least one row actually carries a stage value.
  const stageDefs = finalRows.some((r) => r.rawStage) ? await getStageDefinitions(orgId) : []
  const stageByNormalizedKey = new Map(stageDefs.map((s) => [normalizeHeader(s.key), s.key]))
  const stageByNormalizedLabel = new Map(stageDefs.map((s) => [normalizeHeader(s.label), s.key]))

  function resolveStage(rawStage: string): { stage: string | null; matched: boolean } {
    if (!rawStage) return { stage: null, matched: true } // absent/empty — existing no-op, defaults to 'new', no issue
    const normalized = normalizeHeader(rawStage)
    const matchedKey = stageByNormalizedKey.get(normalized) ?? stageByNormalizedLabel.get(normalized) ?? null
    return { stage: matchedKey, matched: matchedKey !== null }
  }

  const issuesToCreate: {
    orgId: string
    row: number
    kind: 'skip' | 'stage_unmapped'
    reason: string
    rawValue?: string
    leadId?: string
  }[] = []

  if (finalRows.length > 0) {
    // One row at a time (not createMany) — each new Person must be
    // find-or-created, which createMany can't do inline.
    for (const r of finalRows) {
      const { row: _row, company: _companyName, poc, companyId, customFields, rawStage, ...rest } = r
      const person = poc ? await findOrCreatePerson(orgId, companyId, poc) : null
      // Best-effort, same "drop, don't fail the row" philosophy as the
      // website/businessType handling above — a custom field whose value
      // doesn't match its definition's type (e.g. text in a "number" field)
      // shouldn't block the whole import row from being created.
      let customFieldsJson = '{}'
      if (Object.keys(customFields).length > 0) {
        try {
          customFieldsJson = await mergeCustomFields(orgId, '{}', customFields)
        } catch (err) {
          customFieldWarnings.push({ row: r.row, reason: err instanceof Error ? err.message : String(err) })
        }
      }
      const { stage: matchedStage, matched } = resolveStage(rawStage)
      const lead = await prisma.lead.create({
        data: {
          ...rest,
          orgId,
          stage: matchedStage ?? 'new',
          ownerId: owner.id,
          ownerName: owner.name,
          companyId,
          personId: person?.id ?? null,
          customFieldsJson,
        },
      })

      // Present and non-empty, but didn't match any real StageDefinition —
      // the lead is still created (defaulted to 'new', never blocks
      // creation), but this is recorded so it can be reviewed/corrected
      // later via the sync-review screen, rather than silently lost.
      if (!matched) {
        issuesToCreate.push({
          orgId,
          row: r.row,
          kind: 'stage_unmapped',
          reason: `Sheet value "${rawStage}" did not match any pipeline stage`,
          rawValue: rawStage,
          leadId: lead.id,
        })
      }
    }
  }

  skipped.sort((a, b) => a.row - b.row)
  customFieldWarnings.sort((a, b) => a.row - b.row)

  // Only the cron caller passes jobRunId — the manual CSV dialog has no
  // JobRun to attach to and doesn't need post-hoc review (its result is
  // already shown live in the dialog).
  if (jobRunId) {
    for (const s of skipped) {
      issuesToCreate.push({ orgId, row: s.row, kind: 'skip', reason: s.reason })
    }
    if (issuesToCreate.length > 0) {
      await prisma.jobRunIssue.createMany({
        data: issuesToCreate.map((issue) => ({ ...issue, jobRunId })),
      })
    }
  }

  return { created: finalRows.length, skipped, customFieldWarnings }
}
