import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, isAdmin, isOperations } from '@/lib/session'
import { getStageDefinitions } from '@/lib/pipelineConfig'
import { suggestStageForValue } from '@/lib/stageSuggest'

export const dynamic = 'force-dynamic'

// Admin/ops only, same convention as the Ops dashboard this links from
// (app/settings/ops/page.tsx redirects non-admins — operations additionally
// gets access here since they're the role that actually works stage
// corrections day-to-day, same as leadScope()'s admin/operations grouping).
function canReview(user: { role: string }) {
  return isAdmin(user as never) || isOperations(user as never)
}

// Returns unresolved JobRunIssue rows for a job run, triggering a lazy
// Gemini suggestion fill-in for any stage_unmapped row still missing one —
// this is what keeps the sync route itself fast and free of a new external
// API dependency in its hot path (see lib/stageSuggest.ts's own comment).
// Re-opening this screen never re-calls Gemini for a row that already has a
// cached suggestedStage.
export async function GET(_req: Request, { params }: { params: Promise<{ jobRunId: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!canReview(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { jobRunId } = await params

  // Resolve via the JobRun row first so a job run from another org 404s
  // (not 403 — confirming existence of another tenant's row is itself a
  // leak) rather than ever branching on a client-supplied orgId.
  const jobRun = await prisma.jobRun.findFirst({
    where: { id: jobRunId, OR: [{ orgId: { in: user.visibleOrgIds } }, { orgId: null }] },
    select: { id: true, orgId: true },
  })
  if (!jobRun) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const issues = await prisma.jobRunIssue.findMany({
    where: { jobRunId, resolvedAt: null },
    // Only the two names the review panel shows, not whole lead rows.
    include: { lead: { select: { company: { select: { name: true } }, person: { select: { name: true } } } } },
    orderBy: { row: 'asc' },
  })

  const stageUnmapped = issues.filter((i) => i.kind === 'stage_unmapped' && !i.suggestedStage && i.rawValue)
  if (stageUnmapped.length > 0) {
    // All stage_unmapped issues on one job run share the same org, so one
    // stage-definitions lookup covers the whole batch.
    const stageDefs = await getStageDefinitions(jobRun.orgId ?? stageUnmapped[0].orgId)
    const availableStages = stageDefs.map((s) => ({ key: s.key, label: s.label }))

    await Promise.all(
      stageUnmapped.map(async (issue) => {
        const suggestion = await suggestStageForValue(issue.rawValue!, availableStages)
        if (suggestion.ok) {
          await prisma.jobRunIssue.update({
            where: { id: issue.id },
            data: { suggestedStage: suggestion.stage, suggestionConfidence: suggestion.note },
          })
          issue.suggestedStage = suggestion.stage
          issue.suggestionConfidence = suggestion.note
        }
        // A failed suggestion leaves suggestedStage: null — the row still
        // shows up for manual resolution below, never blocks review.
      }),
    )
  }

  return NextResponse.json({ issues })
}
