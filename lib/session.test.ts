import { describe, expect, it, vi } from 'vitest'

// lib/session.ts also imports lib/db/lib/auth/lib/audit for
// requireUser()/requireApiUser()/resolveSession(), which pulls in
// @neondatabase/auth — irrelevant to the two pure helpers under test here.
// Stub them out instead of loading the real modules.
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/auth', () => ({ neonAuth: { getSession: vi.fn() } }))

const { resolveVisibleOrgIds, leadScope } = await import('@/lib/session')

function user(overrides: Partial<{ id: string; orgId: string; role: string; visibleOrgIds: string[] }> = {}) {
  return {
    id: 'u1',
    name: 'Test',
    email: 't@x.com',
    orgId: 'org-a',
    role: 'sales',
    visibleOrgIds: ['org-a'],
    orgName: 'Test Org',
    orgLogoUrl: null,
    orgLogoDataUrl: null,
    orgBrandColor: null,
    ...overrides,
  }
}

describe('resolveVisibleOrgIds', () => {
  it('always returns exactly the one org passed in — orgs are flat, no rollup', () => {
    expect(resolveVisibleOrgIds('org-a')).toEqual(['org-a'])
    expect(resolveVisibleOrgIds('org-b')).toEqual(['org-b'])
  })
})

describe('leadScope', () => {
  it('scopes a sales user to their own org and their own ownerId — never role-bypasses the org filter', () => {
    const scope = leadScope(user({ role: 'sales', visibleOrgIds: ['org-a'] }))
    expect(scope).toEqual({ orgId: { in: ['org-a'] }, ownerId: 'u1' })
  })

  it('scopes an admin to their own org, with no ownerId restriction', () => {
    const scope = leadScope(user({ role: 'admin', visibleOrgIds: ['org-a'] }))
    expect(scope).toEqual({ orgId: { in: ['org-a'] } })
  })

  it('scopes operations the same way as admin', () => {
    const scope = leadScope(user({ role: 'operations', visibleOrgIds: ['org-a'] }))
    expect(scope).toEqual({ orgId: { in: ['org-a'] } })
  })

  it('never returns an unbounded scope — even an admin\'s scope always carries an orgId filter', () => {
    const scope = leadScope(user({ role: 'admin' })) as { orgId?: unknown }
    expect(scope.orgId).toBeDefined()
  })
})
