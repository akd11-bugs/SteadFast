import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The callback must only finish a Gmail connect this browser started: the
// `state` in the URL has to match the cookie set by the start route.
// Otherwise a forged callback link could bind an attacker's Gmail to the
// signed-in victim.

const update = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { user: { update: (a: unknown) => update(a) } } }))
vi.mock('@/lib/session', () => ({ requireApiUser: async () => ({ id: 'u-1' }) }))
vi.mock('@/lib/crypto', () => ({ encrypt: (s: string) => `enc:${s}` }))

const getToken = vi.fn()
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    getToken = getToken
    verifyIdToken = async () => ({ getPayload: () => ({ email: 'rep@acme.com' }) })
  },
}))

const { GET } = await import('./route')

function callback(query: string, cookie?: string) {
  return new NextRequest(`https://app.test/api/settings/email/oauth/callback?${query}`, {
    headers: cookie ? { cookie: `gmail_oauth_state=${cookie}` } : {},
  })
}

const goodTokens = {
  tokens: { refresh_token: 'rt', id_token: 'idt', scope: 'openid https://www.googleapis.com/auth/gmail.send email' },
}

beforeEach(() => {
  update.mockReset()
  getToken.mockReset()
  getToken.mockResolvedValue(goodTokens)
  process.env.GOOGLE_CLIENT_ID = 'cid'
  process.env.GOOGLE_CLIENT_SECRET = 'secret'
})

describe('Gmail OAuth callback', () => {
  it.each([
    ['no cookie', 'code=c&state=s1', undefined],
    ['state mismatch', 'code=c&state=attacker', 's1'],
    ['no state in URL', 'code=c', 's1'],
  ])('rejects %s without exchanging the code', async (_label, query, cookie) => {
    const res = await GET(callback(query, cookie))
    expect(res.headers.get('location')).toContain('gmailError=1')
    expect(getToken).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a grant without the gmail.send scope', async () => {
    getToken.mockResolvedValue({ tokens: { ...goodTokens.tokens, scope: 'openid email' } })
    const res = await GET(callback('code=c&state=s1', 's1'))
    expect(res.headers.get('location')).toContain('gmailError=1')
    expect(update).not.toHaveBeenCalled()
  })

  it('connects when state matches, and clears the state cookie', async () => {
    const res = await GET(callback('code=c&state=s1', 's1'))
    expect(res.headers.get('location')).toContain('gmailConnected=1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u-1' } }))
    expect(res.headers.get('set-cookie')).toMatch(/gmail_oauth_state=;/)
  })
})
