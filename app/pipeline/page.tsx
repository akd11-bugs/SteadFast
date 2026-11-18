import { prisma } from '@/lib/db'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { requireUser, leadScope } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const user = await requireUser()
  const leads = await prisma.lead.findMany({
    where: leadScope(user),
    orderBy: [{ stage: 'asc' }, { position: 'asc' }],
    include: { company: true, person: true },
  })
  return (
    <div className="space-y-4 -mx-4 md:-mx-6 px-4 md:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Drag a lead between columns, or use the ⇄ button on a card, to change its stage. Stale leads (no activity past 21 days) are flagged.
        </p>
      </div>
      <KanbanBoard initialLeads={leads as any} />
    </div>
  )
}