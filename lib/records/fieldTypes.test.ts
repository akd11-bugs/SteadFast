import { describe, expect, it, vi } from 'vitest'

const queryRaw = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: queryRaw } }))
vi.mock('./scope', () => ({ recordScope: () => ({ orgId: { in: ['o1'] }, objectTypeId: 't1' }) }))
import { validateConfig, validateValue, validateValues, type FieldDef } from './fieldTypes'
import { filterSql, queryRecords } from './query'
import type { SessionUser } from '@/lib/session'

const f = (type: string, config: unknown = {}, required = false): FieldDef => ({ key: 'k', label: 'K', type, config, required })
const status = f('status', { options: [{ key: 'open', label: 'Open' }, { key: 'won', label: 'Won', isWon: true }] })

describe('validateValue', () => {
  it('normalises good values', () => {
    expect(validateValue(f('number'), '12.5')).toEqual({ value: 12.5 })
    expect(validateValue(f('email'), ' A@B.co ')).toEqual({ value: 'a@b.co' })
    expect(validateValue(f('date'), '2026-02-28')).toEqual({ value: '2026-02-28' })
    expect(validateValue(status, 'won')).toEqual({ value: 'won' })
    expect(validateValue(f('link'), 'rec_1')).toEqual({ value: ['rec_1'] })
    expect(validateValue(f('text'), '')).toEqual({ value: null })
  })

  it('rejects bad values', () => {
    expect(validateValue(f('number'), 'abc')).toHaveProperty('error')
    expect(validateValue(f('date'), '2026-02-30')).toHaveProperty('error')
    expect(validateValue(status, 'lost')).toHaveProperty('error')
    expect(validateValue(f('checkbox'), 'yes')).toHaveProperty('error')
    expect(validateValue(f('multi_select', { options: [{ key: 'a', label: 'A' }] }), ['a', 'b'])).toHaveProperty('error')
    expect(validateValue(f('link'), ['ok', 'bad id!'])).toHaveProperty('error')
  })

  it('refuses script URLs', () => {
    expect(validateValue(f('url'), 'javascript:alert(1)')).toHaveProperty('error')
    expect(validateValue(f('url'), 'https://x.io/a')).toEqual({ value: 'https://x.io/a' })
  })
})

describe('validateValues', () => {
  const fields = [f('text', {}, true), { ...f('number'), key: 'n', label: 'N' }]

  it('rejects unknown keys and missing required fields on create', () => {
    expect(validateValues(fields, { n: 1 }, { partial: false })).toEqual({ errors: ['K is required'] })
    expect(validateValues(fields, { k: 'x', evil: 1 }, { partial: false })).toEqual({ errors: ['unknown field "evil"'] })
  })

  it('allows partial updates but not clearing a required field', () => {
    expect(validateValues(fields, { n: '3' }, { partial: true })).toEqual({ values: { n: 3 } })
    expect(validateValues(fields, { k: '' }, { partial: true })).toEqual({ errors: ['K is required'] })
  })
})

describe('validateConfig', () => {
  it('requires unique option keys and keeps won/lost only on status', () => {
    expect(validateConfig('select', { options: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] })).toHaveProperty('error')
    expect(validateConfig('select', { options: [{ key: 'a', label: 'A', isWon: true }] })).toEqual({ config: { options: [{ key: 'a', label: 'A' }] } })
    expect(validateConfig('status', { options: [{ key: 'w', label: 'W', isWon: true }] })).toEqual({ config: { options: [{ key: 'w', label: 'W', isWon: true }] } })
    expect(validateConfig('link', {})).toHaveProperty('error')
  })

  it('defaults a missing currency to INR and rejects a malformed one', () => {
    expect(validateConfig('currency', {})).toEqual({ config: { currency: 'INR' } })
    expect(validateConfig('currency', { currency: 'USD' })).toEqual({ config: { currency: 'USD' } })
    expect(validateConfig('currency', { currency: 'usd' })).toEqual({ error: 'currency must be a 3-letter code like INR' })
    expect(validateConfig('currency', { currency: 5 })).toHaveProperty('error')
  })
})

describe('filterSql', () => {
  it('binds the field key and value as parameters, never as SQL text', () => {
    const sql = filterSql({ ...f('text'), key: 'x"; DROP TABLE' }, { field: 'x', op: 'eq', value: "'; --" })
    expect(typeof sql).not.toBe('string')
    if (typeof sql === 'string') return
    expect(sql.sql).not.toContain('DROP')
    expect(sql.values).toEqual(['x"; DROP TABLE', "'; --"])
  })

  it('rejects ops that do not fit the field type', () => {
    expect(filterSql(f('checkbox'), { field: 'k', op: 'contains', value: 'a' })).toBeTypeOf('string')
    expect(filterSql(f('text'), { field: 'k', op: 'gt', value: 1 })).toBeTypeOf('string')
  })
})

describe('queryRecords', () => {
  const user = {} as SessionUser
  const obj = { id: 't1', restrictToOwner: false }

  it('refuses to sort by person, link and multi_select fields', async () => {
    for (const type of ['person', 'link', 'multi_select']) {
      expect(await queryRecords(user, obj, [f(type)], { sort: { field: 'k', dir: 'asc' } })).toEqual({
        error: `cannot sort by ${type} fields`,
      })
    }
  })

  it('matches nothing when searching an object with no text fields', async () => {
    queryRaw.mockReset()
    queryRaw.mockResolvedValue([])
    await queryRecords(user, obj, [f('number')], { search: 'acme' })
    const sql = queryRaw.mock.calls[0][0] as { sql: string }
    expect(sql.sql).toContain('FALSE')
  })
})
