import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { SessionUser } from '@/lib/session'
import { recordScope } from './scope'
import { readConfig, type FieldDef } from './fieldTypes'

// One query layer for every view (table now; kanban/calendar in step 2).
// Filter and sort keys must be field keys of this object — checked against
// the org's own field list before any SQL is built — and every value is a
// bound parameter. No client string ever becomes SQL text (invariant 2).

export type FilterOp = 'eq' | 'contains' | 'gt' | 'lt' | 'empty' | 'not_empty'
export interface Filter {
  field: string
  op: FilterOp
  value?: string | number | boolean
}
export interface QueryInput {
  filters?: Filter[]
  sort?: { field: string; dir: 'asc' | 'desc' }
  search?: string
  page?: number
  pageSize?: number
}

const SYSTEM_SORTS = { createdAt: Prisma.sql`"createdAt"`, updatedAt: Prisma.sql`"updatedAt"` } as const
const NUMERIC = new Set(['number', 'currency'])
const ARRAY = new Set(['multi_select', 'link'])
const UNSORTABLE = new Set(['multi_select', 'person', 'link'])
const TEXTUAL = new Set(['text', 'long_text', 'email', 'phone', 'url'])
export const MAX_PAGE_SIZE = 100
const MAX_FILTERS = 20

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// Builds one SQL condition from a filter, or an error string for a bad filter.
export function filterSql(field: FieldDef, f: Filter): Prisma.Sql | string {
  const key = field.key
  const text = Prisma.sql`("values" ->> ${key})`
  if (f.op === 'empty') return Prisma.sql`(NOT ("values" ? ${key}) OR "values" -> ${key} IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb))`
  if (f.op === 'not_empty') return Prisma.sql`("values" ? ${key} AND "values" -> ${key} NOT IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb))`
  if (f.value === undefined || f.value === null) return `filter on "${key}" needs a value`
  const v = f.value
  if (f.op === 'eq') {
    if (ARRAY.has(field.type)) return Prisma.sql`("values" -> ${key}) @> ${JSON.stringify([String(v)])}::jsonb`
    if (field.type === 'checkbox') return Prisma.sql`COALESCE("values" -> ${key}, 'false'::jsonb) = ${JSON.stringify(v === true || v === 'true')}::jsonb`
    if (NUMERIC.has(field.type)) {
      const n = Number(v)
      return Number.isFinite(n) ? Prisma.sql`(${text})::numeric = ${n}` : `filter on "${key}" needs a number`
    }
    return Prisma.sql`${text} = ${String(v)}`
  }
  if (f.op === 'contains') {
    // For list fields "contains" means "has this option / record id", same as eq.
    if (ARRAY.has(field.type)) return Prisma.sql`("values" -> ${key}) @> ${JSON.stringify([String(v)])}::jsonb`
    if (!TEXTUAL.has(field.type)) return `"contains" does not apply to ${field.type} fields`
    return Prisma.sql`${text} ILIKE ${`%${escapeLike(String(v))}%`}`
  }
  if (f.op === 'gt' || f.op === 'lt') {
    const cmp = f.op === 'gt' ? Prisma.sql`>` : Prisma.sql`<`
    if (NUMERIC.has(field.type)) {
      const n = Number(v)
      return Number.isFinite(n) ? Prisma.sql`(${text})::numeric ${cmp} ${n}` : `filter on "${key}" needs a number`
    }
    // Dates are stored as YYYY-MM-DD, so string order is date order.
    if (field.type === 'date') return Prisma.sql`${text} ${cmp} ${String(v)}`
    return `"${f.op}" applies only to number, currency and date fields`
  }
  return `unknown filter op "${String(f.op)}"`
}

export async function queryRecords(
  user: SessionUser,
  objectType: { id: string; restrictToOwner: boolean },
  fields: FieldDef[],
  input: QueryInput,
) {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const scope = recordScope(user, objectType)
  const conds: Prisma.Sql[] = [
    Prisma.sql`"orgId" = ANY(${scope.orgId.in})`,
    Prisma.sql`"objectTypeId" = ${scope.objectTypeId}`,
  ]
  if ('ownerId' in scope) conds.push(Prisma.sql`"ownerId" = ${scope.ownerId}`)

  const filters = input.filters ?? []
  if (filters.length > MAX_FILTERS) return { error: `at most ${MAX_FILTERS} filters` }
  for (const f of filters) {
    const field = byKey.get(f.field)
    if (!field) return { error: `unknown field "${f.field}"` }
    const sql = filterSql(field, f)
    if (typeof sql === 'string') return { error: sql }
    conds.push(sql)
  }

  const search = input.search?.trim()
  if (search) {
    const textKeys = fields.filter((f) => TEXTUAL.has(f.type)).map((f) => f.key)
    // shortcut: search is an ILIKE scan over text fields; add a tsvector column if orgs pass ~100k records per object.
    if (textKeys.length) {
      const pat = `%${escapeLike(search.slice(0, 100))}%`
      conds.push(Prisma.sql`(${Prisma.join(textKeys.map((k) => Prisma.sql`("values" ->> ${k}) ILIKE ${pat}`), ' OR ')})`)
    } else {
      // Nothing searchable: a search term must match nothing, not everything.
      conds.push(Prisma.sql`FALSE`)
    }
  }

  let order: Prisma.Sql = Prisma.sql`"updatedAt" DESC`
  if (input.sort) {
    const dir = input.sort.dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`
    const sys = SYSTEM_SORTS[input.sort.field as keyof typeof SYSTEM_SORTS]
    const field = byKey.get(input.sort.field)
    if (sys) order = Prisma.sql`${sys} ${dir}`
    else if (!field) return { error: `unknown sort field "${input.sort.field}"` }
    else if (UNSORTABLE.has(field.type)) return { error: `cannot sort by ${field.type} fields` }
    else if (field.type === 'status' || field.type === 'select') {
      // Option order, not label order: the admin's list is the meaningful order.
      const keys = (readConfig(field.config).options ?? []).map((o) => o.key)
      order = Prisma.sql`array_position(${keys}::text[], "values" ->> ${field.key}) ${dir} NULLS LAST`
    } else if (NUMERIC.has(field.type)) order = Prisma.sql`(("values" ->> ${field.key}))::numeric ${dir} NULLS LAST`
    else order = Prisma.sql`("values" ->> ${field.key}) ${dir} NULLS LAST`
    order = Prisma.sql`${order}, "id" ASC`
  }

  const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize ?? 50)), MAX_PAGE_SIZE)
  const rawPage = Number.isFinite(input.page) ? (input.page as number) : 1
  const page = Math.min(Math.max(1, Math.floor(rawPage)), 100_000)
  const where = Prisma.join(conds, ' AND ')

  const [rows, count] = await Promise.all([
    prisma.$queryRaw<
      { id: string; values: Prisma.JsonValue; ownerId: string | null; createdById: string; createdAt: Date; updatedAt: Date }[]
    >(Prisma.sql`SELECT "id", "values", "ownerId", "createdById", "createdAt", "updatedAt"
      FROM "ObjectRecord" WHERE ${where} ORDER BY ${order}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "ObjectRecord" WHERE ${where}`),
  ])
  return { records: rows, total: Number(count[0]?.n ?? 0), page, pageSize }
}
