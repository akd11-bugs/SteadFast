import Link from 'next/link'
import { X } from 'lucide-react'
import { prisma } from '@/lib/db'
import { LeadsTable } from '@/components/leads/LeadsTable'
import { requireUser, leadScope, isAdmin } from '@/lib/session'
import { BOARD_COLUMN_LABELS, boardColumnToInput, SOURCE_LABELS, type BoardColumnKey, type LeadSource } from '@/lib/types'
import { getRange, parseRangeKey, RANGE_LABELS, type RangeKey } from '@/lib/reportRange'
import { getPendingSubStatusDefinitions } from '@/lib/pipelineConfig'
import { buildFilters } from '@/lib/leadFilters'

export const dynamic = 'force-dynamic'


export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string
    owner?: string
    source?: string
    stage?: string
    q?: string
    metric?: string
    range?: string
  }>
}) {
  const user = await requireUser()
  const { filter, owner, source, stage, q, metric, range: rawRange } = await searchParams
  const matched = filter ? buildFilters(new Date())[filter] : undefined
  const pendingSubStatusDefs = await getPendingSubStatusDefinitions(user.orgId)
  const pendingSubStatusKeys = pendingSubStatusDefs.map((s) => s.key)

  // Period-scoped drill-down from Reports — e.g. "leads created this week" —
  // distinct from buildFilters()'s always-current-month presets.
  const range: RangeKey | null = metric ? parseRangeKey(rawRange) : null
  const periodBounds = range ? getRange(range) : null
  const periodWhere =
    metric === 'created' && periodBounds
      ? { createdAt: { gte: periodBounds.start, lte: periodBounds.end } }
      : metric === 'onboarded' && periodBounds
        ? { wonAt: { gte: periodBounds.start, lte: periodBounds.end } }
        : {}

  const labels: string[] = []
  if (matched) labels.push(matched.label)
  if (metric && range) {
    labels.push(`${metric === 'created' ? 'Leads created' : 'Onboarded'} · ${RANGE_LABELS[range]}`)
  }
  if (owner) labels.push(`Owner: ${owner}`)
  if (source) labels.push(`Source: ${SOURCE_LABELS[source as LeadSource] ?? source}`)
  if (stage) labels.push(`Stage: ${BOARD_COLUMN_LABELS[stage as BoardColumnKey] ?? stage}`)

  // `stage` may be a plain Stage ('new', 'onboarding', 'not_interested') or a
  // board-column pseudo-stage — one of the pending sub-statuses — coming from
  // links generated off boardColumnFor() elsewhere (funnel charts, Kanban).
  // boardColumnToInput() maps either back to the real {stage, pendingSubStatus}.
  const stageWhere = stage
    ? pendingSubStatusKeys.includes(stage)
      ? boardColumnToInput(stage as BoardColumnKey, pendingSubStatusKeys)
      : { stage }
    : {}

  const leads = await prisma.lead.findMany({
    where: {
      ...leadScope(user),
      ...(matched?.where as object),
      ...periodWhere,
      ...(owner ? { ownerName: owner } : {}),
      ...(source ? { source } : {}),
      ...stageWhere,
    },
    orderBy: { updatedAt: 'desc' },
    include: { company: true, person: true },
  })

  const admin = isAdmin(user)
  const owners = admin
    ? await prisma.user.findMany({ where: { isActive: true, orgId: { in: user.visibleOrgIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    : []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="text-sm text-muted-foreground">All leads across all stages. Click a row for details.</p>
      </div>
      {labels.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-accent/40 px-3 py-2 text-sm">
          <span>
            Showing: <strong>{labels.join(' · ')}</strong> · {leads.length} lead{leads.length === 1 ? '' : 's'}
          </span>
          <Link href="/leads" className="flex items-center gap-1 text-blue-600 hover:underline">
            <X className="h-3.5 w-3.5" />
            Clear filter
          </Link>
        </div>
      )}
      <LeadsTable
        initialLeads={leads as any}
        initialQuery={q}
        /* 'pending' has no column of its own (its sub-statuses are the columns), so it can't seed the column filter. */
        initialStage={stage && stage !== 'pending' ? stage : undefined}
        initialSource={source as LeadSource | undefined}
        canReassign={admin} ownerOptions={owners} />
    </div>
  )
}
