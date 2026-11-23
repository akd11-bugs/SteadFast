// Shapes and pure helpers shared by the record-engine UI (components/records).
// Safe to import from client components: no prisma, no server-only code.
import { readConfig, type FieldConfig, type FieldOption, type FieldType, type Value } from './fieldTypes'

export interface ObjectTypeDTO {
  id: string
  key: string
  name: string
  icon: string | null
  position: number
  restrictToOwner: boolean
}

export interface FieldDTO {
  id: string
  key: string
  label: string
  type: FieldType
  config: FieldConfig
  required: boolean
  position: number
}

export interface RecordDTO {
  id: string
  values: { [key: string]: Value }
  ownerId: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

export interface PersonDTO {
  id: string
  name: string
  isActive: boolean
}

export const TYPE_LABELS: { [K in FieldType]: string } = {
  text: 'Text',
  long_text: 'Long text',
  number: 'Number',
  currency: 'Currency',
  date: 'Date',
  status: 'Status',
  select: 'Select',
  multi_select: 'Multi-select',
  person: 'Person',
  link: 'Link to record',
  email: 'Email',
  phone: 'Phone',
  url: 'URL',
  checkbox: 'Checkbox',
}

export const OPTION_TYPES: ReadonlySet<string> = new Set(['status', 'select', 'multi_select'])

// Maps a prisma ObjectField row (type: string, config: Json) to the UI shape.
export function toFieldDTO(f: {
  id: string
  key: string
  label: string
  type: string
  config: unknown
  required: boolean
  position: number
}): FieldDTO {
  return { id: f.id, key: f.key, label: f.label, type: f.type as FieldType, config: readConfig(f.config), required: f.required, position: f.position }
}

// Option keys are opaque ids; labels are what the user edits.
export function newOptionKey(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0')
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong'
}

// fetch + JSON with the API's {error, details} surfaced as the thrown message,
// so every caller can show it instead of failing silently.
export async function api<T>(url: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const hasBody = init.body !== undefined
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const d = (data && typeof data === 'object' ? data : {}) as { error?: unknown; details?: unknown }
    const msg = typeof d.error === 'string' ? d.error : `Request failed (${res.status})`
    const details = Array.isArray(d.details) ? d.details.filter((x): x is string => typeof x === 'string') : []
    throw new Error(details.length ? `${msg}: ${details.join('; ')}` : msg)
  }
  return data as T
}

// ---- form drafts -------------------------------------------------------
// Inputs hold a draft (numbers as typed strings, empty = ''); toValue turns
// it into what the API takes. The server validates; we only shape.
export type Draft = string | boolean | string[]

export function toDraft(type: FieldType, v: Value | undefined): Draft {
  if (type === 'checkbox') return v === true
  if (type === 'multi_select' || type === 'link') return Array.isArray(v) ? v : []
  if (v === null || v === undefined) return ''
  return String(v)
}

export function toValue(type: FieldType, d: Draft): Value {
  if (typeof d === 'boolean') return d
  if (Array.isArray(d)) return d.length ? d : null
  const s = type === 'long_text' ? d : d.trim()
  if (s === '') return null
  if (type === 'number' || type === 'currency') {
    const n = Number(s)
    return Number.isFinite(n) ? n : s // non-numeric goes through so the server's message is shown
  }
  return s
}

// ---- display -----------------------------------------------------------
export function findOption(config: FieldConfig, key: string): FieldOption | undefined {
  return config.options?.find((o) => o.key === key)
}

export function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-IN')
}

export function formatCurrency(n: number, currency = 'INR'): string {
  try {
    return n.toLocaleString('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 })
  } catch {
    return `${currency} ${formatNumber(n)}` // unknown ISO code
  }
}

// A record's display title: the value of its first text field, else its id.
export function recordTitle(fields: { type: string; key: string }[], values: { [key: string]: Value }, id: string): string {
  const first = fields.find((f) => f.type === 'text')
  const v = first ? values[first.key] : null
  return typeof v === 'string' && v.trim() ? v : id
}
