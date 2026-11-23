import { beforeEach, describe, expect, it, vi } from 'vitest'
import bcrypt from 'bcryptjs'

// A one-row fake that behaves like Postgres where it matters here: reads
// return a snapshot, `increment` is atomic, updateMany honours its condition.
// Parallel calls interleave at every await, as real requests do.
type Row = {
  id: string; orgId: string; name: string; email: string; isActive: boolean; pinHash: string
  pinFailedAttempts: number; pinLockedUntil: Date | null
  failedLoginAttempts: number; lockedUntil: Date | null
}
let row: Row
const tick = () => new Promise((r) => setTimeout(r, 0))

function apply(data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    const inc = (v as { increment?: number } | null)?.increment
    ;(row as Record<string, unknown>)[k] = inc ? (row as unknown as Record<string, number>)[k] + inc : v
  }
}
function matches(where: Record<string, unknown>) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'id') return v === row.id
    const cur = (row as Record<string, unknown>)[k] as Date | null
    if (v === null) return cur === null
    const lte = (v as { lte?: Date }).lte
    return lte ? cur !== null && cur <= lte : cur === v
  })
}

const prismaFake = {
  user: {
    findFirst: async () => { await tick(); return { ...row } },
    findUnique: async () => { await tick(); return { ...row } },
    update: async ({ data }: { data: Record<string, unknown> }) => { await tick(); apply(data); return { ...row } },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      await tick()
      if (!matches(where)) return { count: 0 }
      apply(data)
      return { count: 1 }
    },
  },
}

vi.mock('@/lib/db', () => ({ prisma: prismaFake }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }))
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIpFromHeaders: async () => '1.2.3.4',
}))
const signIn = vi.fn()
vi.mock('@/lib/auth', () => ({ neonAuth: { signIn: { email: (...a: unknown[]) => signIn(...a) } } }))

const { verifyRepLogin } = await import('@/lib/repAuth')
const { signInWithLockout } = await import('@/lib/loginLockout')

const PIN = '424242'
const pinHash = bcrypt.hashSync(PIN, 4)

beforeEach(() => {
  row = {
    id: 'u1', orgId: 'org-a', name: 'Priya', email: 'p@x.com', isActive: true, pinHash,
    pinFailedAttempts: 0, pinLockedUntil: null, failedLoginAttempts: 0, lockedUntil: null,
  }
  signIn.mockReset()
})

describe('rep PIN lockout', () => {
  it('20 parallel wrong PINs check at most 5 and leave the account locked', async () => {
    const compare = vi.spyOn(bcrypt, 'compare')
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => verifyRepLogin('org-a', 'Priya', String(100000 + i))),
    )
    expect(compare.mock.calls.length).toBeLessThanOrEqual(5)
    expect(results.filter((r) => !r.ok && r.status === 401).length).toBeLessThanOrEqual(4)
    expect(row.pinLockedUntil).not.toBeNull()
    // Even the right PIN is refused while locked.
    expect(await verifyRepLogin('org-a', 'Priya', PIN)).toMatchObject({ ok: false, status: 423 })
    compare.mockRestore()
  })

  it('an expired lock starts a fresh count, so the right PIN works again', async () => {
    row.pinFailedAttempts = 9
    row.pinLockedUntil = new Date(Date.now() - 1000)
    expect(await verifyRepLogin('org-a', 'Priya', PIN)).toEqual({ ok: true, userId: 'u1' })
    expect(row.pinFailedAttempts).toBe(0)
  })
})

describe('password lockout', () => {
  it('20 parallel wrong passwords reach Neon Auth at most 5 times and lock the account', async () => {
    signIn.mockResolvedValue({ error: { message: 'bad' } })
    await Promise.all(Array.from({ length: 20 }, () => signInWithLockout('p@x.com', 'wrong')))
    expect(signIn.mock.calls.length).toBeLessThanOrEqual(5)
    expect(row.lockedUntil).not.toBeNull()
  })

  it('a correct password after an expired lock signs in and resets the count', async () => {
    row.failedLoginAttempts = 7
    row.lockedUntil = new Date(Date.now() - 1000)
    signIn.mockResolvedValue({ error: null })
    expect(await signInWithLockout('p@x.com', 'right')).toEqual({ ok: true })
    expect(row.failedLoginAttempts).toBe(0)
  })
})
