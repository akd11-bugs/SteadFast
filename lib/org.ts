import { prisma } from '@/lib/db'
import type { Organization } from '@prisma/client'
import { findOrCreateCompany, findOrCreatePerson } from '@/lib/company'
import { uniqueOrgSlug } from '@/lib/orgSlug'
import { Prisma } from '@prisma/client'

// Creates a brand-new, fully isolated company org — used by self-serve
// signup (a founding admin creating their own company) and the
// create-admin bootstrap script. There is no "default" or "root" org
// concept: every org is its own flat tenant from the start.
// Every org gets a slug at creation: it is what makes /rep/<slug> work, and
// an org without one has no field-rep login at all. Retries on a unique-index
// collision, because uniqueOrgSlug's check-then-insert is racy by nature and
// the index is the real guard.
export async function createOrganization(name: string): Promise<Organization> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await uniqueOrgSlug(name)
    try {
      return await prisma.organization.create({ data: { name, slug } })
    } catch (err) {
      const isSlugCollision =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        String(err.meta?.target ?? '').includes('slug')
      if (!isSlugCollision) throw err
      // Someone took this slug between the check and the insert — recompute.
    }
  }
  // Give the org a working record rather than failing signup outright; the
  // backfill script can assign a slug afterwards.
  return prisma.organization.create({ data: { name } })
}

const SAMPLE_LEADS = [
  {
    company: 'Northwind Traders',
    person: 'Priya Shah',
    email: 'priya@example.com',
    stage: 'new',
    source: 'referral',
    estimatedVolume: 25000,
    notes: 'Sample lead — this is what a fresh inbound lead looks like. Delete me once you add real ones.',
  },
  {
    company: 'Lumen Retail Co',
    person: 'Marcus Webb',
    email: 'marcus@example.com',
    stage: 'pending',
    source: 'website',
    estimatedVolume: 48000,
    notes: 'Sample lead — sitting in Pending, waiting on a reply.',
  },
  {
    company: 'Solstice Apparel',
    person: 'Dana Kim',
    email: 'dana@example.com',
    stage: 'proposal',
    source: 'linkedin',
    estimatedVolume: 90000,
    notes: 'Sample lead — proposal sent, tracking toward close.',
  },
] as const

// Seeds a handful of clearly-labeled example leads for every brand-new org,
// so the dashboard is never a wall of zeros on day one. Called explicitly
// from the self-serve org-creation routes (not from createOrganization
// itself) — the create-admin bootstrap script and tests create orgs too,
// and shouldn't get fake data mixed into a real deployment or a mock.
export async function seedSampleLeads(orgId: string): Promise<void> {
  for (const sample of SAMPLE_LEADS) {
    const company = await findOrCreateCompany(orgId, sample.company)
    const person = await findOrCreatePerson(orgId, company.id, sample.person, { email: sample.email })
    await prisma.lead.create({
      data: {
        orgId,
        companyId: company.id,
        personId: person.id,
        email: sample.email,
        source: sample.source,
        stage: sample.stage,
        estimatedVolume: sample.estimatedVolume,
        notes: sample.notes,
      },
    })
  }
}

// Every org that exists — used by the one platform-level route that operates
// across all companies rather than one caller's own org: the daily activity
// report cron, which still sends each org its own separate report. (The
// external reports API used to be a second caller here too, but it's now
// scoped to one org per API key — see app/api/external/reports/route.ts.)
export async function getAllOrgIds(): Promise<string[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  return orgs.map((o) => o.id)
}
