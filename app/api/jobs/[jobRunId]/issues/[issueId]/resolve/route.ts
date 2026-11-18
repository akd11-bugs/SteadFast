import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, isAdmin, isOperations } from '@/lib/session'
import { readJsonBody } from '@/lib/http'
import { applyStageChange } from '@/lib/leadStage'
import { getStageDefinitions } from '@/lib/pipelineConfig'

export const dynamic = 'force-dynamic'

function canReview(user: { role: string }) {
  return isAdmin(user as never) || isOperations(user as never)
}

// Body: {stage: string} — the human's final choice, which may equal the AI
// suggestion or override it. For a stage_unmapped issue this goes through
// applyStageChange (lib/leadStage.ts), NOT a raw prisma.lead.update — that is
// the single shared stage-transition path already used by every other
// stage-change entry point in the app (dashboard PATCH, bulk PATCH, Kanban
// drag), and is what fires evaluateStageRules() (workflow automation) and
// writes the Activity log entry. Bypassing it would silently diverge from
// how every other stage change in the app behaves.
//
// A kind: 'skip' issue has no stage to resolve — its "resolve" action is
// just acknowledging it (no lead exists to act on).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobRunId: string; issueId: string }> },
) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  if (!canReview(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { jobRunId, issueId } = await params

  const issue = await prisma.jobRunIssue.findFirst({
    where: { id: issueId, jobRunId, orgId: { in: user.visibleOrgIds } },
  })
  if (!issue) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (issue.resolvedAt) return NextResponse.json({ error: 'Issue already resolved' }, { status: 409 })

  if (issue.kind === 'skip') {
    const resolved = await prisma.jobRunIssue.update({
      where: { id: issueId },
      data: { resolvedBy: user.id, resolvedAt: new Date() },
    })
    return NextResponse.json({ issue: resolved })
  }

  // kind === 'stage_unmapped'
  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body
  const stage = typeof body.stage === 'string' ? body.stage.trim() : ''
  if (!stage) {
    return NextResponse.json({ error: 'stage is required' }, { status: 400 })
  }
  if (!issue.leadId) {
    // Shouldn't happen — every stage_unmapped issue is created alongside the
    // lead it's attached to — but guards against a corrupted/manually-edited row.
    return NextResponse.json({ error: 'This issue has no associated lead' }, { status: 400 })
  }

  const stageDefs = await getStageDefinitions(issue.orgId)
  if (!stageDefs.some((s) => s.key === stage)) {
    return NextResponse.json({ error: 'stage is not one of this organization\'s pipeline stages' }, { status: 400 })
  }

  const existing = await prisma.lead.findFirst({
    where: { id: issue.leadId, orgId: { in: user.visibleOrgIds } },
    select: { orgId: true, stage: true, wonAt: true, onboardedAt: true, onboardingSubStage: true, pendingSubStatus: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await applyStageChange(
    issue.leadId,
    existing,
    { stage, remark: 'Corrected during sheet sync review' },
    { name: user.name },
  )

  const resolved = await prisma.jobRunIssue.update({
    where: { id: issueId },
    data: { resolvedStage: stage, resolvedBy: user.id, resolvedAt: new Date() },
  })

  return NextResponse.json({ issue: resolved })
}
