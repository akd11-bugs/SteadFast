import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate, newOptionKey, recordTitle, toDraft, toValue } from './client'

describe('record UI helpers', () => {
  it('round-trips drafts and values per type', () => {
    expect(toValue('number', toDraft('number', 12.5))).toBe(12.5)
    expect(toValue('number', '')).toBeNull()
    expect(toValue('currency', 'abc')).toBe('abc') // left for the server to reject with a message
    expect(toValue('text', '  hi ')).toBe('hi')
    expect(toValue('long_text', ' keep ')).toBe(' keep ')
    expect(toValue('checkbox', toDraft('checkbox', null))).toBe(false)
    expect(toValue('multi_select', toDraft('multi_select', null))).toBeNull()
    expect(toValue('link', ['a'])).toEqual(['a'])
    expect(toDraft('date', null)).toBe('')
  })

  it('formats dates without a timezone shift', () => {
    expect(formatDate('2026-01-01')).toContain('2026')
    expect(formatDate('2026-01-01')).toContain('1')
    expect(formatDate('nope')).toBe('nope')
  })

  it('formats currency and survives an unknown code', () => {
    expect(formatCurrency(1500, 'INR')).toContain('1,500')
    expect(formatCurrency(5, 'ZZZZ')).toBe('ZZZZ 5')
  })

  it('titles a record by its first text field, else its id', () => {
    const fields = [
      { type: 'number', key: 'n' },
      { type: 'text', key: 'name' },
    ]
    expect(recordTitle(fields, { name: 'Order 7' }, 'r1')).toBe('Order 7')
    expect(recordTitle(fields, { name: '' }, 'r1')).toBe('r1')
    expect(recordTitle([], {}, 'r1')).toBe('r1')
  })

  it('makes option keys the server accepts', () => {
    for (let i = 0; i < 50; i++) expect(newOptionKey()).toMatch(/^[a-z0-9]{8}$/)
  })
})
