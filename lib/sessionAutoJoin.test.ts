import { beforeEach, describe, expect, it, vi } from 'vitest'

// Domain auto-join was removed: an identity with no User row gets no access,
// whatever its email domain. Joining an existing org takes an invite.
const userFindUniqueMock = vi.fn()
const userCreateMock = vi.fn()
const getSessionMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      create: (...args: unknown[]) => userCreateMock(...args),
    },
  },
}))
vi.mock('@/lib/auth', () => ({ neonAuth: { getSession: (...args: unknown[]) => getSessionMock(...args) } }))

const { resolveSession } = await import('@/lib/session')

beforeEach(() => {
  userFindUniqueMock.mockReset()
  userCreateMock.mockReset()
  getSessionMock.mockReset()
  delete process.env.DEV_BYPASS_AUTH_EMAIL
})

describe('resolveSession — no email-domain auto-join', () => {
  it('a verified identity whose domain matches an existing org still gets no-app-user and no User row', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { email: 'new@acme.com', name: 'New Rep', emailVerified: true } } })
    userFindUniqueMock.mockResolvedValueOnce(null)

    const result = await resolveSession()

    expect(userCreateMock).not.toHaveBeenCalled()
    expect(result).toEqual({ kind: 'no-app-user' })
  })

  it('an existing User row resolves as ok', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { email: 'existing@acme.com', name: 'Existing' } } })
    const existing = { id: 'u-existing', orgId: 'org-acme', email: 'existing@acme.com', role: 'admin', isActive: true }
    userFindUniqueMock.mockResolvedValueOnce(existing)

    const result = await resolveSession()

    expect(userCreateMock).not.toHaveBeenCalled()
    expect(result).toEqual({ kind: 'ok', user: existing })
  })

  it('a deactivated User row resolves as inactive', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { email: 'gone@acme.com' } } })
    userFindUniqueMock.mockResolvedValueOnce({ id: 'u-gone', email: 'gone@acme.com', isActive: false })

    expect(await resolveSession()).toEqual({ kind: 'inactive' })
  })
})
