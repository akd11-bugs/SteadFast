import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userFindFirstMock = vi.fn()
const userFindManyMock = vi.fn()
const cursorFindUniqueMock = vi.fn()
const cursorUpsertMock = vi.fn()
const orgSheetConnectorFindManyMock = vi.fn()
const orgSheetConnectorUpdateMock = vi.fn()
const getSheetRowsMock = vi.fn()
const importLeadRowsMock = vi.fn()
const recordJobRunMock = vi.fn()
const leadFieldDefinitionFindManyMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findFirst: (...args: unknown[]) => userFindFirstMock(...args),
      findMany: (...args: unknown[]) => userFindManyMock(...args),
    },
    syncCursor: {
      findUnique: (...args: unknown[]) => cursorFindUniqueMock(...args),
      upsert: (...args: unknown[]) => cursorUpsertMock(...args),
    },
    orgSheetConnector: {
      findMany: (...args: unknown[]) => orgSheetConnectorFindManyMock(...args),
      update: (...args: unknown[]) => orgSheetConnectorUpdateMock(...args),
    },
    leadFieldDefinition: {
      findMany: (...args: unknown[]) => leadFieldDefinitionFindManyMock(...args),
    },
  },
}))

vi.mock('@/lib/googleSheets', () => ({
  getSheetRows: (...args: unknown[]) => getSheetRowsMock(...args),
}))

vi.mock('@/lib/leadImport', () => ({
  importLeadRows: (...args: unknown[]) => importLeadRowsMock(...args),
}))

vi.mock('@/lib/jobRun', () => ({
  recordJobRun: (...args: unknown[]) => recordJobRunMock(...args),
}))

const { POST } = await import('./route')

const ENV_KEYS = ['CRON_SYNC_API_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}

function req(token?: string) {
  const headers: Record<string, string> = {}
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  return new Request('http://x/api/cron/sync-leads-sheet', { method: 'POST', headers })
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.CRON_SYNC_API_KEY = 'test-key'

  userFindFirstMock.mockReset()
  userFindManyMock.mockReset()
  cursorFindUniqueMock.mockReset()
  cursorUpsertMock.mockReset()
  orgSheetConnectorFindManyMock.mockReset()
  orgSheetConnectorUpdateMock.mockReset()
  getSheetRowsMock.mockReset()
  importLeadRowsMock.mockReset()
  recordJobRunMock.mockReset()
  leadFieldDefinitionFindManyMock.mockReset()

  userFindManyMock.mockResolvedValue([{ id: 'org-a-owner', name: 'Org A Owner' }])
  cursorFindUniqueMock.mockResolvedValue(null)
  cursorUpsertMock.mockResolvedValue({})
  leadFieldDefinitionFindManyMock.mockResolvedValue([])
  orgSheetConnectorFindManyMock.mockResolvedValue([
    { orgId: 'org-a', sheetId: 'org-a-sheet', sheetRange: 'Leads', defaultOwnerUserId: 'org-a-owner' },
  ])
  orgSheetConnectorUpdateMock.mockResolvedValue({})
  importLeadRowsMock.mockResolvedValue({ created: 0, skipped: [], customFieldWarnings: [] })
  recordJobRunMock.mockResolvedValue(undefined)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('POST /api/cron/sync-leads-sheet', () => {
  it('returns 503 when CRON_SYNC_API_KEY is not configured', async () => {
    delete process.env.CRON_SYNC_API_KEY
    const res = await POST(req('anything'))
    expect(res.status).toBe(503)
  })

  it('returns 401 with no Authorization header', async () => {
    const res = await POST(req())
    expect(res.status).toBe(401)
  })

  it('returns 401 with a wrong bearer token', async () => {
    const res = await POST(req('wrong-key'))
    expect(res.status).toBe(401)
  })

  it('returns an empty results array when no org has a connector configured', async () => {
    orgSheetConnectorFindManyMock.mockResolvedValue([])
    const res = await POST(req('test-key'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [] })
  })

  it('short-circuits with created:0 when the sheet has only a header row (or is empty)', async () => {
    getSheetRowsMock.mockResolvedValue([['Company', 'Email']])
    const res = await POST(req('test-key'))
    const body = await res.json()
    expect(body.results).toEqual([{ source: 'org:org-a', created: 0, skipped: [], customFieldWarnings: [] }])
    expect(importLeadRowsMock).not.toHaveBeenCalled()
  })

  it('short-circuits with created:0 when the cursor already covers every data row', async () => {
    getSheetRowsMock.mockResolvedValue([
      ['Company', 'Email'],
      ['Acme', 'a@acme.com'],
    ])
    cursorFindUniqueMock.mockResolvedValue({ value: '1' })
    const res = await POST(req('test-key'))
    const body = await res.json()
    expect(body.results).toEqual([{ source: 'org:org-a', created: 0, skipped: [], customFieldWarnings: [] }])
    expect(importLeadRowsMock).not.toHaveBeenCalled()
  })

  it('processes only rows past the cursor, and advances the cursor to the full data-row count', async () => {
    getSheetRowsMock.mockResolvedValue([
      ['Company', 'Email'],
      ['Old Co', 'old@co.com'],
      ['New Co', 'new@co.com'],
    ])
    cursorFindUniqueMock.mockResolvedValue({ value: '1' })
    importLeadRowsMock.mockResolvedValue({ created: 1, skipped: [], customFieldWarnings: [] })

    await POST(req('test-key'))

    expect(importLeadRowsMock).toHaveBeenCalledTimes(1)
    const [rowsArg] = importLeadRowsMock.mock.calls[0]
    expect(rowsArg).toHaveLength(1)
    expect(rowsArg[0].company).toBe('New Co')

    expect(cursorUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'leads-sheet:org:org-a' },
        create: { key: 'leads-sheet:org:org-a', value: '2' },
        update: { value: '2' },
      })
    )
  })

  it('creates a fresh cursor at zero when none exists, treating every data row as new', async () => {
    getSheetRowsMock.mockResolvedValue([
      ['Company', 'Email'],
      ['Acme', 'a@acme.com'],
    ])
    await POST(req('test-key'))
    const [rowsArg] = importLeadRowsMock.mock.calls[0]
    expect(rowsArg).toHaveLength(1)
  })

  it('resolves an owner by email/name from the Owner column, falling back to the default owner when unmatched', async () => {
    getSheetRowsMock.mockResolvedValue([
      ['Company', 'Email', 'Owner'],
      ['Acme', 'a@acme.com', 'rep@example.com'],
      ['Beta', 'b@beta.com', 'nobody-matches@example.com'],
    ])
    userFindFirstMock.mockImplementation(async ({ where }: any) => {
      const value = where.OR[0].email.equals
      return value === 'rep@example.com' ? { id: 'rep-1', name: 'Rep One' } : null
    })

    await POST(req('test-key'))

    // Two distinct resolved owners -> two separate importLeadRows calls, one bucket each.
    expect(importLeadRowsMock).toHaveBeenCalledTimes(2)
    const owners = importLeadRowsMock.mock.calls.map((c) => c[1].id).sort()
    expect(owners).toEqual(['org-a-owner', 'rep-1'].sort())
  })

  it('treats a blank Owner cell as unresolved and falls back to the default owner without querying the DB', async () => {
    getSheetRowsMock.mockResolvedValue([
      ['Company', 'Email', 'Owner'],
      ['Acme', 'a@acme.com', '  '],
    ])
    await POST(req('test-key'))
    expect(userFindFirstMock).not.toHaveBeenCalled()
    expect(importLeadRowsMock.mock.calls[0][1].id).toBe('org-a-owner')
  })

  it('remaps skipped row numbers from the importLeadRows-local index back to real sheet row numbers', async () => {
    getSheetRowsMock.mockResolvedValue([
      ['Company', 'Email'],
      ['Old Co', 'old@co.com'],
      ['Old Co 2', 'old2@co.com'],
      ['Bad Row', 'not-an-email'],
    ])
    cursorFindUniqueMock.mockResolvedValue({ value: '2' }) // first two rows already processed
    importLeadRowsMock.mockResolvedValue({ created: 0, skipped: [{ row: 1, reason: 'Invalid email' }], customFieldWarnings: [] })

    const res = await POST(req('test-key'))
    const body = await res.json()
    // "row" is a 1-based data-row index (row 1 = first data row under the
    // header), not the literal spreadsheet row: 2 rows already processed by
    // the cursor + this row's own 1-based position lands on 3.
    expect(body.results[0].skipped).toEqual([{ row: 3, reason: 'Invalid email' }])
  })

  it('sums created counts and sorts skipped rows across multiple owner buckets', async () => {
    getSheetRowsMock.mockResolvedValue([
      ['Company', 'Email', 'Owner'],
      ['A', 'a@a.com', 'rep@example.com'],
      ['B', 'bad-email', ''],
    ])
    userFindFirstMock.mockResolvedValue({ id: 'rep-1', name: 'Rep One' })
    importLeadRowsMock.mockImplementation(async (rows: unknown[], owner: { id: string }) => {
      if (owner.id === 'rep-1') return { created: 1, skipped: [], customFieldWarnings: [] }
      return { created: 0, skipped: [{ row: 1, reason: 'Invalid email' }], customFieldWarnings: [] }
    })

    const res = await POST(req('test-key'))
    const body = await res.json()
    expect(body.results[0].created).toBe(1)
    expect(body.results[0].skipped).toEqual([{ row: 2, reason: 'Invalid email' }])
  })

  it('records a successful JobRun scoped to the connector\'s org after a normal sync', async () => {
    getSheetRowsMock.mockResolvedValue([
      ['Company', 'Email'],
      ['Acme', 'a@acme.com'],
    ])
    await POST(req('test-key'))
    expect(recordJobRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-a', jobKey: 'sync-leads-sheet', status: 'success' })
    )
  })

  it('records a failed JobRun and reports an error on that source (not a bare unhandled crash) when importLeadRows throws mid-batch', async () => {
    getSheetRowsMock.mockResolvedValue([
      ['Company', 'Email'],
      ['Acme', 'a@acme.com'],
    ])
    importLeadRowsMock.mockRejectedValue(new Error('DB connection dropped'))

    const res = await POST(req('test-key'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results[0].error).toContain('DB connection dropped')
    expect(recordJobRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: 'sync-leads-sheet', status: 'failure', error: expect.stringContaining('DB connection dropped') })
    )
  })

  it('records a failed JobRun when the configured sheet ID is wrong/inaccessible (a 404 from Google), without crashing the request', async () => {
    getSheetRowsMock.mockRejectedValue(new Error('Google Sheets API error (404): Requested entity was not found.'))

    const res = await POST(req('test-key'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results[0].error).toContain('404')
    expect(recordJobRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-a', jobKey: 'sync-leads-sheet', status: 'failure' })
    )
  })

  it('syncs multiple org connectors independently, each with its own cursor', async () => {
    orgSheetConnectorFindManyMock.mockResolvedValue([
      { orgId: 'org-a', sheetId: 'org-a-sheet', sheetRange: 'Leads', defaultOwnerUserId: 'org-a-owner' },
      { orgId: 'org-b', sheetId: 'org-b-sheet', sheetRange: 'Sheet1', defaultOwnerUserId: 'org-b-owner' },
    ])
    userFindManyMock.mockResolvedValue([
      { id: 'org-a-owner', name: 'Org A Owner' },
      { id: 'org-b-owner', name: 'Org B Owner' },
    ])
    getSheetRowsMock.mockResolvedValue([
      ['Company', 'Email'],
      ['Acme', 'a@acme.com'],
    ])
    importLeadRowsMock.mockResolvedValue({ created: 1, skipped: [], customFieldWarnings: [] })

    const res = await POST(req('test-key'))
    const body = await res.json()

    expect(body.results).toHaveLength(2)
    expect(body.results.map((r: any) => r.source).sort()).toEqual(['org:org-a', 'org:org-b'])
    expect(orgSheetConnectorUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org-a' } }))
    expect(orgSheetConnectorUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org-b' } }))
  })

  it('skips an org connector whose configured default owner no longer exists, without failing the whole run', async () => {
    orgSheetConnectorFindManyMock.mockResolvedValue([
      { orgId: 'org-a', sheetId: 'org-a-sheet', sheetRange: 'Leads', defaultOwnerUserId: 'deleted-user' },
    ])
    userFindManyMock.mockResolvedValue([]) // the connector's configured owner is gone

    const res = await POST(req('test-key'))
    const body = await res.json()

    expect(body.results).toEqual([])
  })
})
