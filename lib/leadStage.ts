import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

// evaluateStageRules (and the workflow actions it runs) need the lead's
// company/person name, so every lead fetched/updated in this file carries
// those relations — see lib/workflow.ts, which shares this same payload type.
export type LeadWithRelations = Prisma.LeadGetPayload<{ include: { company: true; person: true } }>
type Lead = LeadWithRelations
import { boardColumnFor, BOARD_COLUMN_LABELS, type OnboardingSubStage, type PendingSubStatus, type Stage } from '@/lib/types'
import { evaluateStageRules } from '@/lib/workflow'
import { getOnboardingStepDefinitions } from '@/lib/pipelineConfig'

export interface StageChangeActor {
  name: string
}

// Looks up and validates an operations-assignment id — shared by every route
// that can move a lead into onboarding, so "must be a real, active operations
// user" can't drift between them. Returns null for an invalid id (caller
// turns that into a 400).
export async function resolveOpsAssignment(assignedOpsId: string, orgIds: string[]): Promise<{ id: string; name: string } | null> {
  const opsUser = await prisma.user.findFirst({
    where: { id: assignedOpsId, orgId: { in: orgIds } },
    select: { id: true, name: true, role: true, isActive: true },
  })
  if (!opsUser || !opsUser.isActive || opsUser.role !== 'operations') return null
  return { id: opsUser.id, name: opsUser.name }
}

export interface StageChangeInput {
  stage?: Stage
  pendingSubStatus?: PendingSubStatus
  // Required, non-empty — the "what happened on this call" note. Becomes the
  // Activity description verbatim, and doubles as the required reason when
  // stage is 'not_interested'. Callers must validate this before calling in
  // (this function trusts it, so a 400 for an empty remark happens earlier,
  // at the route, where it can be returned to the client properly).
  remark: string
  // Required exactly when entering onboarding from a non-onboarding stage —
  // the route validates assignedOpsId names a real, active operations user
  // and resolves assignedOpsName itself; this function trusts both.
  assignedOpsId?: string
  assignedOpsName?: string
  // The org's current default sub-status (PendingSubStatusDefinition's
  // isDefault row) — every caller already fetches this org's pending
  // sub-status definitions for validation (see lib/types.ts's
  // validPendingSubStatusKeys), so passing the default along costs nothing.
  // Falls back to the seeded-default literal only for a caller that hasn't
  // been updated yet.
  defaultPendingSubStatusKey?: string
  // Org-scoped label overrides for any custom pending sub-status — only
  // needed for sub-status keys not already in the static
  // BOARD_COLUMN_LABELS fallback table (lib/types.ts). Merged over that
  // table below so a custom key's Activity-description text reads its real
  // label instead of the raw key.
  pendingSubStatusLabels?: Record<string, string>
}

type ExistingLead = Pick<Lead, 'orgId' | 'stage' | 'wonAt' | 'onboardedAt' | 'onboardingSubStage' | 'pendingSubStatus'>

// The stage / pendingSubStatus transition core shared by every entry point
// (the dashboard's PATCH /api/leads/[id], the bulk PATCH, Kanban drag, the
// lead detail form) so wonAt / onboardingSubStage / pendingSubStatus /
// workflow-rule behavior can never drift between them the way bulk actions
// used to (see app/api/leads/bulk/route.ts history — it had its own thinner
// copy that silently skipped wonAt and workflow rules).
//
// Only handles the top-level stage and the pending sub-status. Onboarding's
// own sub-pipeline (onboardingSubStage progressing past its auto-seeded
// first step) is a separate, unchanged flow — see
// components/leads/OnboardingProgressPanel.tsx, which PATCHes
// onboardingSubStage directly.
export async function applyStageChange(
  leadId: string,
  existing: ExistingLead,
  input: StageChangeInput,
  actor: StageChangeActor,
): Promise<Lead> {
  const nextStage = input.stage
  const enteringOnboarding = nextStage === 'onboarding' && existing.stage !== 'onboarding'
  const leavingOnboarding = nextStage !== undefined && nextStage !== 'onboarding' && existing.stage === 'onboarding'
  const enteringPending = nextStage === 'pending' && existing.stage !== 'pending'
  const leavingPending = nextStage !== undefined && nextStage !== 'pending' && existing.stage === 'pending'

  // wonAt marks the moment a lead enters onboarding — distinct from
  // onboardedAt (set later, once the onboarding sub-pipeline finishes).
  const nextWonAt = enteringOnboarding ? new Date() : leavingOnboarding ? null : undefined

  // Start on the org's first step by position: admins can delete or reorder
  // steps, so a hard-coded key could point at a step that no longer exists.
  const nextOnboardingSubStage: OnboardingSubStage | null | undefined = enteringOnboarding
    ? (((await getOnboardingStepDefinitions(existing.orgId))[0]?.key ?? 'document_submission') as OnboardingSubStage)
    : leavingOnboarding
      ? null
      : undefined

  // Entering onboarding always starts fresh (not yet onboarded); leaving it
  // clears onboardedAt too. This function never sets onboardingSubStage to
  // 'final_onboarded' itself — that only happens via direct progression
  // through OnboardingProgressPanel, handled separately in the PATCH route.
  const nextOnboardedAt = nextOnboardingSubStage !== undefined ? null : undefined

  // Entering pending with no explicit sub-status defaults to the org's
  // designated default (PendingSubStatusDefinition.isDefault) — whoever
  // picks it up first can immediately correct it. Leaving pending clears it;
  // an explicit value always wins.
  const nextPendingSubStatus: PendingSubStatus | null | undefined =
    input.pendingSubStatus !== undefined
      ? input.pendingSubStatus
      : enteringPending
        ? input.defaultPendingSubStatusKey ?? 'pending_ours'
        : leavingPending
          ? null
          : undefined

  // Assigned the moment a lead enters onboarding (who from Operations picks
  // it up); cleared on leaving so a later re-entry always asks again rather
  // than silently keeping a stale assignee.
  const nextAssignedOpsId = enteringOnboarding ? input.assignedOpsId ?? null : leavingOnboarding ? null : undefined
  const nextAssignedOpsName = enteringOnboarding ? input.assignedOpsName ?? null : leavingOnboarding ? null : undefined

  const data: Record<string, unknown> = { lastActivityAt: new Date() }
  if (nextStage !== undefined) data.stage = nextStage
  if (nextPendingSubStatus !== undefined) data.pendingSubStatus = nextPendingSubStatus
  if (nextOnboardingSubStage !== undefined) data.onboardingSubStage = nextOnboardingSubStage
  if (nextOnboardedAt !== undefined) data.onboardedAt = nextOnboardedAt
  if (nextWonAt !== undefined) data.wonAt = nextWonAt
  if (nextAssignedOpsId !== undefined) data.assignedOpsId = nextAssignedOpsId
  if (nextAssignedOpsName !== undefined) data.assignedOpsName = nextAssignedOpsName

  const lead = await prisma.lead.update({ where: { id: leadId }, data, include: { company: true, person: true } })

  // Prefix the remark with the actual movement (e.g. "New → Pending — Our
  // Side") so the Activity timeline and the daily report both show what
  // happened, not just the rep's free-text note. Custom sub-status keys
  // aren't in BOARD_COLUMN_LABELS, hence the org-scoped override merge —
  // falls back to the raw key itself (never `undefined`) if somehow neither
  // table has it.
  const columnLabels = { ...BOARD_COLUMN_LABELS, ...input.pendingSubStatusLabels }
  const fromColumn = boardColumnFor({ stage: existing.stage, pendingSubStatus: existing.pendingSubStatus })
  const toColumn = boardColumnFor({
    stage: nextStage ?? existing.stage,
    pendingSubStatus: nextPendingSubStatus !== undefined ? nextPendingSubStatus : existing.pendingSubStatus,
  })
  const description =
    fromColumn !== toColumn
      ? `${columnLabels[fromColumn] ?? fromColumn} → ${columnLabels[toColumn] ?? toColumn}: ${input.remark.trim()}`
      : input.remark.trim()

  await prisma.activity.create({
    data: {
      orgId: existing.orgId,
      leadId,
      type: 'stage_change',
      description,
      authorName: actor.name,
    },
  })

  if (nextStage !== undefined && nextStage !== existing.stage) {
    // Best-effort — a broken workflow rule (e.g. bad email config) shouldn't
    // fail the lead update that already succeeded.
    evaluateStageRules(lead, nextStage).catch((err) => console.error('evaluateStageRules failed', err))
  }

  return lead
}
