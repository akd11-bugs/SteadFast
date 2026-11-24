import { beforeEach, describe, expect, it, vi } from 'vitest'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { value: jar.get(n) } : undefined),
    set: (n: string, v: string) => jar.set(n, v),
    delete: () => jar.clear(),
  }),
}))
const row = { id: 'u1', name: 'Priya', email: null, role: 'sales', orgId: 'org-a', isActive: true, pinHash: '$2a$04$old' }
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: async () => ({ ...row }) } } }))
vi.mock('@/lib/session', () => ({ resolveVisibleOrgIds: (o: string) => [o] }))

process.env.REP_SESSION_SECRET = 'test-secret'
const { setRepSessionCookie, getRepSessionUser } = await import('./repSession')

beforeEach(() => {
  jar.clear()
  row.pinHash = '$2a$04$old'
})

describe('rep session', () => {
  it('stays valid while the PIN is unchanged', async () => {
    await setRepSessionCookie('u1')
    expect((await getRepSessionUser())?.id).toBe('u1')
  })

  it('dies when an admin resets the PIN', async () => {
    await setRepSessionCookie('u1')
    row.pinHash = '$2a$04$new'
    expect(await getRepSessionUser()).toBeNull()
  })

  it('rejects an old-format token', async () => {
    jar.set('rep_session', 'u1.9999999999999.deadbeef')
    expect(await getRepSessionUser()).toBeNull()
  })
})
