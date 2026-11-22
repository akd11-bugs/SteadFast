import { describe, expect, it } from 'vitest'
import { SHEET_ID_PATTERN, sheetSafeCell, getSheetRows } from '@/lib/googleSheets'

describe('sheet id validation', () => {
  it('accepts a real-looking spreadsheet id', () => {
    expect(SHEET_ID_PATTERN.test('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')).toBe(true)
  })

  it('rejects an id that would rewrite the API path to read another sheet', () => {
    expect(SHEET_ID_PATTERN.test('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/values/A:Z?x=')).toBe(false)
    expect(SHEET_ID_PATTERN.test('../other')).toBe(false)
  })

  it('getSheetRows refuses a bad id before any network call', async () => {
    await expect(getSheetRows('victim/values/A:Z?x=', 'Sheet1')).rejects.toThrow()
  })
})

describe('sheetSafeCell', () => {
  it('neutralises formula-leading values from public forms', () => {
    expect(sheetSafeCell('=IMPORTXML("http://x")')).toBe(`'=IMPORTXML("http://x")`)
    expect(sheetSafeCell('@SUM(1)')).toBe(`'@SUM(1)`)
    expect(sheetSafeCell('+91 98765 43210')).toBe(`'+91 98765 43210`)
  })

  it('leaves ordinary text untouched', () => {
    expect(sheetSafeCell('Acme Corp')).toBe('Acme Corp')
    expect(sheetSafeCell('')).toBe('')
  })
})
