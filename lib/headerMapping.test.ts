import { describe, expect, it } from 'vitest'
import { autoMapHeaders, autoMapCustomFields, normalizeHeader } from '@/lib/headerMapping'

describe('normalizeHeader', () => {
  it('lowercases, trims, and collapses punctuation to spaces', () => {
    expect(normalizeHeader('  Company Name! ')).toBe('company name')
    expect(normalizeHeader('E-Mail_Address')).toBe('e mail address')
  })
})

describe('autoMapHeaders', () => {
  it('maps exact synonym matches', () => {
    const map = autoMapHeaders(['Company Name', 'Email Address', 'Phone Number'])
    expect(map.company).toBe('Company Name')
    expect(map.email).toBe('Email Address')
    expect(map.phone).toBe('Phone Number')
  })

  it('falls back to fuzzy substring matches for unmapped fields', () => {
    // "Lead Owner Name" isn't an exact synonym for anything, but should not
    // be fuzzily claimed by "poc" either (it contains "name") ahead of an
    // exact match elsewhere — exact matches must win first regardless of order.
    const map = autoMapHeaders(['Companies Name', 'Contact Name'])
    expect(map.company).toBe('Companies Name')
    expect(map.poc).toBe('Contact Name')
  })

  it('never assigns the same column to two fields', () => {
    // "Type" header is an exact synonym for `type`; it must not also be
    // fuzzily grabbed by `businessType` (whose synonyms include "type of business").
    const map = autoMapHeaders(['Type'])
    expect(map.type).toBe('Type')
    expect(map.businessType).toBeNull()
  })

  it('leaves fields null when no header matches', () => {
    const map = autoMapHeaders(['Random Column'])
    expect(map.company).toBeNull()
    expect(map.email).toBeNull()
  })
})

describe('autoMapCustomFields', () => {
  it('maps a leftover column to a custom field by exact label match', () => {
    const headers = ['Company Name', 'Location']
    const claimed = new Set<number>()
    autoMapHeaders(headers, claimed)
    const map = autoMapCustomFields(headers, [{ key: 'location', label: 'Location' }], claimed)
    expect(map.location).toBe('Location')
  })

  it('matches by key when the header does not match the label exactly', () => {
    const headers = ['location']
    const claimed = new Set<number>()
    const map = autoMapCustomFields(headers, [{ key: 'location', label: 'Office Location' }], claimed)
    expect(map.location).toBe('location')
  })

  it('never re-claims a column autoMapHeaders already matched to a fixed field', () => {
    // "Notes" is an exact synonym for the fixed `notes` field — a custom
    // field also labeled "Notes" must not also grab it.
    const headers = ['Notes']
    const claimed = new Set<number>()
    autoMapHeaders(headers, claimed)
    const map = autoMapCustomFields(headers, [{ key: 'notes2', label: 'Notes' }], claimed)
    expect(map.notes2).toBeNull()
  })

  it('leaves a custom field null when no column matches it', () => {
    const map = autoMapCustomFields(['Random Column'], [{ key: 'location', label: 'Location' }], new Set())
    expect(map.location).toBeNull()
  })
})
