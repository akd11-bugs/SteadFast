import { describe, expect, it, vi } from 'vitest'

const findUnique = vi.fn(async ({ where }: { where: { agentApiKey: string } }) =>
  where.agentApiKey === 'good-key' ? { id: 'org-a' } : null,
)
vi.mock('@/lib/db', () => ({ prisma: { organization: { findUnique: (a: never) => findUnique(a) } } }))

const { requireAgentOrg } = await import('@/lib/agentAuth')

const call = (ip: string, key: string) =>
  requireAgentOrg(new Request('http://x/api/agent/mcp', { headers: { authorization: `Bearer ${key}`, 'x-forwarded-for': ip } }))

describe('agent API per-IP limit', () => {
  it('does not throttle valid-key calls at the 20-per-5-minute bad-key limit', async () => {
    for (let i = 0; i < 50; i++) expect(await call('10.0.0.1', 'good-key')).toEqual({ orgId: 'org-a' })
  })

  it('still stops a bad-key sweep after 20 tries, before touching the database', async () => {
    for (let i = 0; i < 20; i++) expect((await call('10.0.0.2', `bad-${i}`) as Response).status).toBe(401)
    findUnique.mockClear()
    expect((await call('10.0.0.2', 'bad-x') as Response).status).toBe(429)
    expect(findUnique).not.toHaveBeenCalled()
  })
})
