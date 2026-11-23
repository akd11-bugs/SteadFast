// Turns the record engine on or off for one org (docs/specs/record-engine.md,
// section 7: orgs move one at a time, by us; flipping it back is the rollback).
//
//   DATABASE_URL=... node scripts/record-engine-flag.mjs <orgId|slug> on|off
//
// Changes one boolean and never touches data. A non-local target needs
// I_MEAN_IT=yes, the same guard as scripts/seed-org-b.mjs.
import { config } from 'dotenv'

// Load .env.local before @prisma/client is imported: the client reads .env
// (production) on import, and dotenv never overwrites a variable already set.
config({ path: '.env.local' })
config()
const { PrismaClient } = await import('@prisma/client')

const [orgRef, state] = process.argv.slice(2)
if (!orgRef || !['on', 'off'].includes(state)) {
  console.error('usage: node scripts/record-engine-flag.mjs <orgId|slug> on|off')
  process.exit(1)
}
const url = process.env.DATABASE_URL ?? ''
const host = url.replace(/^.*@/, '').replace(/[/?].*$/, '')
if (!(host.startsWith('localhost') || host.startsWith('127.0.0.1')) && process.env.I_MEAN_IT !== 'yes') {
  console.error(`Refusing a non-local database (${host || 'unset'}). Re-run with I_MEAN_IT=yes if intended.`)
  process.exit(1)
}

const db = new PrismaClient()
const org = await db.organization.findFirst({ where: { OR: [{ id: orgRef }, { slug: orgRef }] }, select: { id: true, name: true } })
if (!org) {
  console.error(`No org "${orgRef}" on ${host}`)
  process.exit(1)
}
await db.organization.update({ where: { id: org.id }, data: { recordEngineEnabled: state === 'on' } })
console.log(`Record engine ${state} for "${org.name}" (${org.id}) on ${host}`)
await db.$disconnect()
