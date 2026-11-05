// Shared by the CSV import dialog (components/leads/ImportLeadsDialog.tsx) and
// the Google Sheets sync route — both need to guess which spreadsheet column
// maps to which Lead field from arbitrary header text, so a sheet doesn't
// need exact fixed column names.

export const FIELDS = [
  'company',
  'email',
  'poc',
  'phone',
  'website',
  'industry',
  'businessType',
  'source',
  'type',
  'estimatedVolume',
  'notes',
] as const
export type Field = (typeof FIELDS)[number]

export const FIELD_LABELS: Record<Field, string> = {
  company: 'Company',
  email: 'Email',
  poc: 'POC',
  phone: 'Phone',
  website: 'Website',
  industry: 'Industry',
  businessType: 'Business type',
  source: 'Source',
  type: 'Type',
  estimatedVolume: 'Est. Volume',
  notes: 'Notes',
}

export const FIELD_SYNONYMS: Record<Field, string[]> = {
  company: ['company', 'company name', 'companies name', 'organization', 'organisation', 'merchant', 'merchant name', 'business name', 'account'],
  email: ['email', 'email address', 'work email', 'e mail'],
  poc: ['poc', 'name', 'full name', 'contact name', 'lead name', 'contact', 'point of contact', 'company owner name'],
  phone: ['phone', 'mobile', 'phone number', 'contact number', 'mobile number'],
  website: ['website', 'url', 'web site', 'domain'],
  industry: ['industry', 'vertical', 'category'],
  businessType: ['business type', 'type of business', 'business model', 'b2b b2c', 'lead type', 'customer type'],
  source: ['source', 'lead source', 'channel'],
  type: ['type', 'partner merchant'],
  estimatedVolume: ['estimated volume', 'value', 'volume', 'amount', 'deal value', 'expected volume'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'remark'],
}

export function normalizeHeader(h: string) {
  return h.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim()
}

// `claimedOut`, when passed, collects the indexes this function claimed —
// autoMapCustomFields below takes that same set so it never re-grabs a
// column the fixed fields already matched.
export function autoMapHeaders(headers: string[], claimedOut?: Set<number>): Record<Field, string | null> {
  const normalized = headers.map(normalizeHeader)
  const claimed = claimedOut ?? new Set<number>()
  const map = {} as Record<Field, string | null>

  // Exact matches first, across all fields, so a field with an exact synonym hit
  // never loses its column to another field's fuzzy "includes" match later.
  for (const field of FIELDS) {
    const synonyms = FIELD_SYNONYMS[field].map(normalizeHeader)
    const idx = normalized.findIndex((h, i) => !claimed.has(i) && synonyms.includes(h))
    if (idx !== -1) {
      claimed.add(idx)
      map[field] = headers[idx]
    } else {
      map[field] = null
    }
  }

  // Then fuzzy "includes" matches for whatever's left unmapped.
  for (const field of FIELDS) {
    if (map[field] !== null) continue
    const synonyms = FIELD_SYNONYMS[field].map(normalizeHeader)
    const idx = normalized.findIndex((h, i) => !claimed.has(i) && synonyms.some((s) => h.includes(s)))
    if (idx !== -1) {
      claimed.add(idx)
      map[field] = headers[idx]
    }
  }

  return map
}

export interface CustomFieldDef {
  key: string
  label: string
}

// Matches whatever columns are left over after autoMapHeaders() against an
// org's admin-defined LeadFieldDefinitions (Settings -> Pipeline -> Custom
// fields) by label, same exact-then-fuzzy strategy as the fixed fields above
// — this is what makes an extra sheet column like "Location" land somewhere
// instead of being silently dropped, as long as an admin has defined a
// matching custom field first. `claimed` should be the same Set passed into
// autoMapHeaders for the same header row, so a column already claimed by a
// fixed field (e.g. "Notes") can never also be claimed here.
export function autoMapCustomFields(headers: string[], definitions: CustomFieldDef[], claimed: Set<number>): Record<string, string | null> {
  const normalized = headers.map(normalizeHeader)
  const map: Record<string, string | null> = {}

  for (const def of definitions) {
    const synonyms = [normalizeHeader(def.label), normalizeHeader(def.key)]
    const idx = normalized.findIndex((h, i) => !claimed.has(i) && synonyms.includes(h))
    if (idx !== -1) {
      claimed.add(idx)
      map[def.key] = headers[idx]
    } else {
      map[def.key] = null
    }
  }

  for (const def of definitions) {
    if (map[def.key] !== null) continue
    const synonyms = [normalizeHeader(def.label), normalizeHeader(def.key)]
    const idx = normalized.findIndex((h, i) => !claimed.has(i) && synonyms.some((s) => h.includes(s)))
    if (idx !== -1) {
      claimed.add(idx)
      map[def.key] = headers[idx]
    }
  }

  return map
}
