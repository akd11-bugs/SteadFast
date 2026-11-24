// Shared harness for route-level tenant tests.
//
// Routes are exercised against a recording Prisma stub so each test can
// assert the WHERE clause the handler actually sent. lib/session is stubbed
// wholesale rather than importActual'd: it pulls lib/auth -> @neondatabase/auth
// -> next/headers, none of which resolves outside the Next runtime.

export type Call = { model: string; op: string; args: Record<string, unknown> }

export const calls: Call[] = []

/** Per-(model.op) canned results, set by a test before invoking a handler. */
export const results = new Map<string, unknown>()

export function resetHarness() {
  calls.length = 0
  results.clear()
}

function op(model: string, name: string) {
  return (args: Record<string, unknown> = {}) => {
    calls.push({ model, op: name, args })
    const key = `${model}.${name}`
    if (results.has(key)) return Promise.resolve(results.get(key))
    if (name === 'count') return Promise.resolve(0)
    if (name.endsWith('Many') && name.startsWith('find')) return Promise.resolve([])
    if (name === 'deleteMany' || name === 'updateMany' || name === 'createMany') return Promise.resolve({ count: 0 })
    if (name === 'groupBy' || name === 'aggregate') return Promise.resolve([])
    if (name === 'create' || name === 'update' || name === 'delete') return Promise.resolve({ id: 'row-1' })
    return Promise.resolve(null)
  }
}

function raw(name: string, fallback: unknown) {
  return (q: { sql: string; values: unknown[] }) => {
    calls.push({ model: '$raw', op: name, args: { sql: q.sql, values: q.values } })
    return Promise.resolve(results.has(`$raw.${name}`) ? results.get(`$raw.${name}`) : fallback)
  }
}

function model(name: string) {
  return {
    findMany: op(name, 'findMany'),
    findFirst: op(name, 'findFirst'),
    findUnique: op(name, 'findUnique'),
    count: op(name, 'count'),
    create: op(name, 'create'),
    update: op(name, 'update'),
    delete: op(name, 'delete'),
    deleteMany: op(name, 'deleteMany'),
    updateMany: op(name, 'updateMany'),
    createMany: op(name, 'createMany'),
    groupBy: op(name, 'groupBy'),
    aggregate: op(name, 'aggregate'),
  }
}

export const prismaStub = {
  lead: model('lead'),
  person: model('person'),
  company: model('company'),
  activity: model('activity'),
  task: model('task'),
  user: model('user'),
  savedView: model('savedView'),
  workflowRule: model('workflowRule'),
  organization: model('organization'),
  onboardingDocument: model('onboardingDocument'),
  stageDefinition: model('stageDefinition'),
  onboardingStepDefinition: model('onboardingStepDefinition'),
  pendingSubStatusDefinition: model('pendingSubStatusDefinition'),
  leadFieldDefinition: model('leadFieldDefinition'),
  objectType: model('objectType'),
  objectField: model('objectField'),
  objectRecord: model('objectRecord'),
  skillRun: model('skillRun'),
  jobRunIssue: model('jobRunIssue'),
  // Raw SQL is recorded as { sql, values } so tests can assert bound params.
  $queryRaw: raw('$queryRaw', []),
  $executeRaw: raw('$executeRaw', 0),
  $transaction: async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prismaStub) : arg,
}

/** Mutable current session; tests assign to it before calling a handler. */
export const session: { user: Record<string, unknown> | null } = { user: null }

export function asUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u-sales',
    name: 'Sales User',
    email: 'sales@orga.com',
    role: 'sales',
    orgId: 'org-a',
    visibleOrgIds: ['org-a'],
    ...overrides,
  }
}

// NOTE: vi.mock calls are hoisted by Vitest and must appear at a test
// file's own top level, so they live in the test file rather than here.
// This module provides only the stub objects and state they bind to.

/** Every orgId value that appeared anywhere in the recorded call args. */
export function orgIdsSeen(): unknown[] {
  const found: unknown[] = []
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'orgId') {
        if (val && typeof val === 'object' && 'in' in (val as object)) {
          found.push(...((val as { in: unknown[] }).in ?? []))
        } else found.push(val)
      }
      walk(val)
    }
  }
  for (const c of calls) walk(c.args)
  return found
}

export const params = (id: string) => ({ params: Promise.resolve({ id }) })
