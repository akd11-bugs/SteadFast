import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// Separate file from lib/session.test.ts, which deliberately stubs prisma/
// neonAuth as empty no-ops — resolveSession()'s auto-join branch needs real
// mock implementations instead, so it gets its own setup.
const userFindUniqueMock = vi.fn()
const userCreateMock = vi.fn()
const getSessionMock = vi.fn()
const findOrgByEmailDomainMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      create: (...args: unknown[]) => userCreateMock(...args),
    },
  },
}))
vi.mock('@/lib/auth', () => ({ neonAuth: { getSession: (...args: unknown[]) => getSessionMock(...args) } }))
vi.mock('@/lib/org', () => ({ findOrgByEmailDomain: (...args: unknown[]) => findOrgByEmailDomainMock(...args) }))

const { resolveSession } = await import('@/lib/session')

beforeEach(() => {
  userFindUniqueMock.mockReset()
  userCreateMock.mockReset()
  getSessionMock.mockReset()
  findOrgByEmailDomainMock.mockReset()
  delete process.env.DEV_BYPASS_AUTH_EMAIL
})

describe('resolveSession — domain auto-join', () => {
  it('auto-creates a sales-role User the first time a verified identity domain-matches an existing org', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { email: 'new@acme.com', name: 'New Rep' } } })
    userFindUniqueMock.mockResolvedValueOnce(null) // no existing User row yet
    findOrgByEmailDomainMock.mockResolvedValue({ id: 'org-acme', name: 'Acme' })
    const created = { id: 'u-new', orgId: 'org-acme', email: 'new@acme.com', name: 'New Rep', role: 'sales', isActive: true }
    userCreateMock.mockResolvedValue(created)

    const result = await resolveSession()

    expect(userCreateMock).toHaveBeenCalledWith({
      data: { orgId: 'org-acme', name: 'New Rep', email: 'new@acme.com', passwordHash: null, role: 'sales', isActive: true },
    })
    expect(result).toEqual({ kind: 'ok', user: created })
  })

  it('does not auto-join when no org matches the email domain — falls through to no-app-user', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { email: 'nobody@personalmail.com', name: 'Nobody' } } })
    userFindUniqueMock.mockResolvedValueOnce(null)
    findOrgByEmailDomainMock.mockResolvedValue(null)

    const result = await resolveSession()

    expect(userCreateMock).not.toHaveBeenCalled()
    expect(result).toEqual({ kind: 'no-app-user' })
  })

  it('falls back to re-reading the row on a concurrent-creation race (unique constraint) instead of throwing', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { email: 'race@acme.com', name: 'Race' } } })
    userFindUniqueMock.mockResolvedValueOnce(null) // first lookup: not found yet
    findOrgByEmailDomainMock.mockResolvedValue({ id: 'org-acme', name: 'Acme' })
    const raceError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' })
    userCreateMock.mockRejectedValue(raceError)
    const winner = { id: 'u-winner', orgId: 'org-acme', email: 'race@acme.com', name: 'Race', role: 'sales', isActive: true }
    userFindUniqueMock.mockResolvedValueOnce(winner) // re-read after the race

    const result = await resolveSession()

    expect(result).toEqual({ kind: 'ok', user: winner })
  })

  it('skips auto-join entirely when a User row already exists for that email', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { email: 'existing@acme.com', name: 'Existing' } } })
    const existing = { id: 'u-existing', orgId: 'org-acme', email: 'existing@acme.com', role: 'admin', isActive: true }
    userFindUniqueMock.mockResolvedValueOnce(existing)

    const result = await resolveSession()

    expect(findOrgByEmailDomainMock).not.toHaveBeenCalled()
    expect(userCreateMock).not.toHaveBeenCalled()
    expect(result).toEqual({ kind: 'ok', user: existing })
  })
})
