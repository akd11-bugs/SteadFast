// Field types for the record engine and the one validator every write goes
// through. The UI is never trusted: API routes call validateValues() on every
// create and update (docs/specs/record-engine.md, security invariant 3).

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'currency',
  'date',
  'status',
  'select',
  'multi_select',
  'person',
  'link',
  'email',
  'phone',
  'url',
  'checkbox',
] as const
// shortcut: 'file' is in the spec's v1 list but needs object storage; add it with the documents move.

export type FieldType = (typeof FIELD_TYPES)[number]

export interface FieldOption {
  key: string
  label: string
  color?: string
  isWon?: boolean
  isLost?: boolean
}

export interface FieldConfig {
  options?: FieldOption[]
  currency?: string
  targetObjectTypeId?: string
}

// The subset of ObjectField the validator needs.
export interface FieldDef {
  key: string
  label: string
  type: string
  config: unknown
  required: boolean
}

export type Value = string | number | boolean | string[] | null

const OPTION_TYPES = new Set(['status', 'select', 'multi_select'])
const MAX_TEXT = 500
const MAX_LONG_TEXT = 20_000
const MAX_OPTIONS = 100
const MAX_LINKS = 100
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isFieldType(t: unknown): t is FieldType {
  return typeof t === 'string' && (FIELD_TYPES as readonly string[]).includes(t)
}

export function readConfig(config: unknown): FieldConfig {
  return config && typeof config === 'object' && !Array.isArray(config) ? (config as FieldConfig) : {}
}

// A stable key from a label: "Order value" -> "order_value_k3x9". The random
// suffix keeps keys unique without a lookup; keys are never shown or edited.
export function makeKey(label: string, suffix: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return `${base || 'field'}_${suffix}`
}

// Validates a field's config when the field is created or edited.
export function validateConfig(type: FieldType, raw: unknown): { config: FieldConfig } | { error: string } {
  const c = readConfig(raw)
  if (OPTION_TYPES.has(type)) {
    if (!Array.isArray(c.options) || c.options.length === 0) return { error: 'options must be a non-empty list' }
    if (c.options.length > MAX_OPTIONS) return { error: `at most ${MAX_OPTIONS} options` }
    const seen = new Set<string>()
    const options: FieldOption[] = []
    for (const o of c.options) {
      const label = typeof o?.label === 'string' ? o.label.trim().slice(0, 80) : ''
      const key = typeof o?.key === 'string' && ID_RE.test(o.key) ? o.key : ''
      if (!label || !key) return { error: 'every option needs a key and a label' }
      if (seen.has(key)) return { error: `duplicate option key "${key}"` }
      seen.add(key)
      options.push({
        key,
        label,
        ...(typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? { color: o.color } : {}),
        ...(type === 'status' && o.isWon ? { isWon: true } : {}),
        ...(type === 'status' && o.isLost ? { isLost: true } : {}),
      })
    }
    return { config: { options } }
  }
  if (type === 'currency') {
    if (c.currency === undefined) return { config: { currency: 'INR' } }
    if (typeof c.currency !== 'string' || !/^[A-Z]{3}$/.test(c.currency)) return { error: 'currency must be a 3-letter code like INR' }
    return { config: { currency: c.currency } }
  }
  if (type === 'link') {
    if (typeof c.targetObjectTypeId !== 'string' || !ID_RE.test(c.targetObjectTypeId)) {
      return { error: 'targetObjectTypeId is required for a link field' }
    }
    return { config: { targetObjectTypeId: c.targetObjectTypeId } }
  }
  return { config: {} }
}

function optionKeys(field: FieldDef): Set<string> {
  return new Set((readConfig(field.config).options ?? []).map((o) => o.key))
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

// Normalises one value for its field type, or returns an error message.
// `null` means "clear this field".
export function validateValue(field: FieldDef, raw: unknown): { value: Value } | { error: string } {
  if (isEmpty(raw)) return { value: null }
  const bad = (why: string) => ({ error: `${field.label}: ${why}` })
  switch (field.type) {
    case 'text':
    case 'phone': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return bad('must be text')
      const s = String(raw).trim()
      return s.length > MAX_TEXT ? bad(`at most ${MAX_TEXT} characters`) : { value: s }
    }
    case 'long_text': {
      if (typeof raw !== 'string') return bad('must be text')
      return raw.length > MAX_LONG_TEXT ? bad(`at most ${MAX_LONG_TEXT} characters`) : { value: raw }
    }
    case 'number':
    case 'currency': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
      return Number.isFinite(n) ? { value: n } : bad('must be a number')
    }
    case 'date': {
      if (typeof raw !== 'string' || !DATE_RE.test(raw)) return bad('must be a date (YYYY-MM-DD)')
      const d = new Date(`${raw}T00:00:00Z`)
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? bad('is not a real date') : { value: raw }
    }
    case 'status':
    case 'select': {
      if (typeof raw !== 'string' || !optionKeys(field).has(raw)) return bad('is not one of the options')
      return { value: raw }
    }
    case 'multi_select': {
      if (!Array.isArray(raw)) return bad('must be a list')
      const keys = optionKeys(field)
      const picked = [...new Set(raw)]
      if (!picked.every((k): k is string => typeof k === 'string' && keys.has(k))) return bad('has a value that is not an option')
      return { value: picked }
    }
    case 'person': {
      if (typeof raw !== 'string' || !ID_RE.test(raw)) return bad('must be a user id')
      return { value: raw }
    }
    case 'link': {
      // shortcut: links live in `values` as id arrays, not a RecordLink table; add the table when backlinks need their own queries at scale.
      const ids = Array.isArray(raw) ? raw : [raw]
      if (ids.length > MAX_LINKS) return bad(`at most ${MAX_LINKS} links`)
      if (!ids.every((id): id is string => typeof id === 'string' && ID_RE.test(id))) return bad('must be record ids')
      return { value: [...new Set(ids)] }
    }
    case 'email': {
      if (typeof raw !== 'string') return bad('must be an email')
      const s = raw.trim().toLowerCase()
      return EMAIL_RE.test(s) && s.length <= 254 ? { value: s } : bad('must be an email')
    }
    case 'url': {
      if (typeof raw !== 'string') return bad('must be a URL')
      try {
        const u = new URL(raw.trim())
        // Only http(s): a javascript: URL rendered as a link would run script.
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return bad('must start with http:// or https://')
        return { value: u.toString() }
      } catch {
        return bad('must be a URL')
      }
    }
    case 'checkbox':
      return typeof raw === 'boolean' ? { value: raw } : bad('must be true or false')
    default:
      return bad(`unknown field type "${field.type}"`)
  }
}

// Validates a whole input object against the object's fields.
// - Unknown keys are rejected (no silent junk in JSONB).
// - `partial` (updates): only the given keys are checked, but a required field
//   may not be cleared. Without `partial` (creates) every required field must be set.
// Returns only the keys that were given; the caller merges into existing values.
export function validateValues(
  fields: FieldDef[],
  input: unknown,
  opts: { partial: boolean },
): { values: { [key: string]: Value } } | { errors: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: ['values must be an object'] }
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const errors: string[] = []
  const values: { [key: string]: Value } = {}
  for (const [key, raw] of Object.entries(input)) {
    const field = byKey.get(key)
    if (!field) {
      errors.push(`unknown field "${key}"`)
      continue
    }
    const r = validateValue(field, raw)
    if ('error' in r) errors.push(r.error)
    else if (r.value === null && field.required) errors.push(`${field.label} is required`)
    else values[key] = r.value
  }
  if (!opts.partial) {
    for (const f of fields) if (f.required && !(f.key in values)) errors.push(`${f.label} is required`)
  }
  return errors.length ? { errors } : { values }
}
