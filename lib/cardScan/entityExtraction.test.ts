import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAccessTokenMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('google-auth-library', () => ({
  JWT: class {
    getAccessToken = getAccessTokenMock
  },
}))

const { extractCardEntities } = await import('@/lib/cardScan/entityExtraction')

beforeEach(() => {
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'svc@example.iam.gserviceaccount.com'
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----'
  getAccessTokenMock.mockReset().mockResolvedValue({ token: 'test-token' })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

function mockEntitiesResponse(entities: { name: string; type: string; salience: number }[]) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ entities }) })
}

describe('extractCardEntities', () => {
  it('returns empty for blank text without calling the API', async () => {
    const result = await extractCardEntities('   ')
    expect(result).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('picks the highest-salience ORGANIZATION and PERSON', async () => {
    mockEntitiesResponse([
      { name: 'Acme Corp', type: 'ORGANIZATION', salience: 0.8 },
      { name: 'Some Other Co', type: 'ORGANIZATION', salience: 0.1 },
      { name: 'Jane Doe', type: 'PERSON', salience: 0.6 },
      { name: 'A Mentioned Person', type: 'PERSON', salience: 0.05 },
    ])
    const result = await extractCardEntities('Jane Doe, Acme Corp')
    expect(result).toEqual({ company: 'Acme Corp', poc: 'Jane Doe' })
  })

  it('omits a field when no entity of that type is present', async () => {
    mockEntitiesResponse([{ name: 'Jane Doe', type: 'PERSON', salience: 0.6 }])
    const result = await extractCardEntities('Jane Doe')
    expect(result).toEqual({ poc: 'Jane Doe' })
  })

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => 'quota exceeded' })
    await expect(extractCardEntities('some text')).rejects.toThrow(/403/)
  })
})
