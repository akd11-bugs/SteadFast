import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser, leadScope } from '@/lib/session'
import { RecordNavigator } from '@/components/shared/RecordNavigator'
import { LeadPageView } from '@/components/leads/LeadPageView'
import type { Lead } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params
  // findFirst + leadScope, never findUnique by id: the id is global, so only
  // the scope keeps another org's (or another rep's) lead out. Miss = 404.
  const lead = await prisma.lead.findFirst({
    where: { id, ...leadScope(user) },
    include: {
      activities: { orderBy: { date: 'desc' } },
      skillRuns: { orderBy: { createdAt: 'desc' }, take: 30 },
      company: true,
      person: true,
    },
  })
  if (!lead) notFound()

  // Same default ordering the main /leads table uses (newest created first),
  // so "N of M" and the prev/next arrows step through the set it was opened from.
  const siblingIds = await prisma.lead.findMany({
    where: leadScope(user),
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  const index = siblingIds.findIndex((l) => l.id === id)
  const prevId = index > 0 ? siblingIds[index - 1].id : null
  const nextId = index >= 0 && index < siblingIds.length - 1 ? siblingIds[index + 1].id : null

  return (
    <div className="space-y-4 max-w-4xl">
      <RecordNavigator
        backHref="/leads"
        backLabel="Back to leads"
        prevHref={prevId ? `/leads/${prevId}` : null}
        nextHref={nextId ? `/leads/${nextId}` : null}
        index={index + 1}
        total={siblingIds.length}
        listLabel="Leads"
      />
      <LeadPageView initialLead={lead as unknown as Lead} />
    </div>
  )
}
