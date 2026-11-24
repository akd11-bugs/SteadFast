import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser, leadScope } from '@/lib/session'
import { validateLeadFields, ONBOARDING_SUB_STAGE_LABELS } from '@/lib/types'
import { readJsonBody } from '@/lib/http'
import { applyStageChange, resolveOpsAssignment } from '@/lib/leadStage'
import { mergeCustomFields } from '@/lib/leadCustomFields'
import { getStageDefinitions, getOnboardingStepDefinitions, getPendingSubStatusDefinitions } from '@/lib/pipelineConfig'
import { findOrCreateCompany, findOrCreatePerson } from '@/lib/company'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const { id } = await params
  const lead = await prisma.lead.findFirst({
    where: { id, ...leadScope(user) },
    include: {
      activities: { orderBy: { date: 'desc' } },
      skillRuns: { orderBy: { createdAt: 'desc' }, take: 20 },
      company: true,
      person: true,
    },
  })
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ lead })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const { id } = await params
  const body = await readJsonBody(req)
  if (body instanceof NextResponse) return body

  const [stageDefs, onboardingStepDefs, pendingSubStatusDefs] = await Promise.all([
    getStageDefinitions(user.orgId),
    getOnboardingStepDefinitions(user.orgId),
    getPendingSubStatusDefinitions(user.orgId),
  ])
  const validationError = validateLeadFields(body, {
    validStageKeys: stageDefs.map((s) => s.key),
    validOnboardingStepKeys: onboardingStepDefs.map((s) => s.key),
    validPendingSubStatusKeys: pendingSubStatusDefs.map((s) => s.key),
  })
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })
  const onboardingStepLabels = Object.fromEntries(onboardingStepDefs.map((s) => [s.key, s.label]))
  const pendingSubStatusLabels = Object.fromEntries(pendingSubStatusDefs.map((s) => [s.key, s.label]))
  const defaultPendingSubStatusKey = pendingSubStatusDefs.find((s) => s.isDefault)?.key

  const existing = await prisma.lead.findFirst({
    where: { id, ...leadScope(user) },
    select: { orgId: true, stage: true, wonAt: true, onboardedAt: true, onboardingSubStage: true, pendingSubStatus: true, customFieldsJson: true, companyId: true, personId: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isStageChange = body.stage !== undefined && body.stage !== existing.stage
  const isPendingSubStatusChange =
    body.pendingSubStatus !== undefined && body.pendingSubStatus !== existing.pendingSubStatus

  // Top-level stage / pending-sub-status changes always require a remark and
  // go through the shared applyStageChange (also used by the bulk route,
  // Kanban, and the lead detail form) — never combined with plain field
  // edits in the same request (the dialogs that trigger this send only
  // {stage or pendingSubStatus, remark}).
  if (isStageChange || isPendingSubStatusChange) {
    const remark = typeof body.remark === 'string' ? body.remark.trim() : ''
    if (!remark) {
      return NextResponse.json({ error: 'A remark is required when changing stage or pending status' }, { status: 400 })
    }

    let assignedOps: { id: string; name: string } | undefined
    if (body.stage === 'onboarding' && existing.stage !== 'onboarding') {
      const assignedOpsId = typeof body.assignedOpsId === 'string' ? body.assignedOpsId : ''
      if (!assignedOpsId) {
        return NextResponse.json({ error: 'An operations person must be assigned to move a lead to Onboarding' }, { status: 400 })
      }
      const resolved = await resolveOpsAssignment(assignedOpsId, user.visibleOrgIds)
      if (!resolved) {
        return NextResponse.json({ error: 'assignedOpsId must be an active operations user' }, { status: 400 })
      }
      assignedOps = resolved
    }

    const lead = await applyStageChange(
      id,
      existing,
      {
        stage: body.stage,
        pendingSubStatus: body.pendingSubStatus,
        remark,
        assignedOpsId: assignedOps?.id,
        assignedOpsName: assignedOps?.name,
        defaultPendingSubStatusKey,
        pendingSubStatusLabels,
      },
      user,
    )
    return NextResponse.json({ lead })
  }

  // Onboarding's own sub-pipeline progression — unchanged, unrelated to the
  // stage/pending-sub-status flow above. Direct onboardingSubStage edits come
  // from components/leads/OnboardingProgressPanel.tsx while stage stays
  // 'onboarding'; no remark required for these.
  const nextSubStage: string | null | undefined = body.onboardingSubStage !== undefined ? body.onboardingSubStage : undefined
  // Steps only exist inside onboarding; otherwise anyone could mark a 'new'
  // lead 'final_onboarded' and inflate the onboarded count in reports.
  if (nextSubStage !== undefined && existing.stage !== 'onboarding') {
    return NextResponse.json({ error: 'Onboarding steps can only change while the lead is in onboarding' }, { status: 400 })
  }

  const nextOnboardedAt =
    nextSubStage === 'final_onboarded'
      ? (existing.onboardedAt ?? new Date())
      : nextSubStage !== undefined
        ? null
        : undefined

  if (nextSubStage !== undefined && nextSubStage !== existing.onboardingSubStage) {
    const fromLabel = existing.onboardingSubStage
      ? (onboardingStepLabels[existing.onboardingSubStage] ?? ONBOARDING_SUB_STAGE_LABELS[existing.onboardingSubStage as keyof typeof ONBOARDING_SUB_STAGE_LABELS] ?? existing.onboardingSubStage)
      : 'Started'
    const toLabel = nextSubStage
      ? (onboardingStepLabels[nextSubStage] ?? ONBOARDING_SUB_STAGE_LABELS[nextSubStage as keyof typeof ONBOARDING_SUB_STAGE_LABELS] ?? nextSubStage)
      : 'Removed from onboarding'
    // description always ends with `(<subStageValue>)` — the Reports page's
    // "Onboarded" metric depends on this exact suffix, see lib/types.ts.
    await prisma.activity.create({
      data: {
        orgId: existing.orgId,
        leadId: id,
        type: 'onboarding_step',
        description: `Onboarding step: ${fromLabel} → ${toLabel} (${nextSubStage ?? 'none'})`,
        authorName: user.name,
      },
    })
  }

  let customFieldsJson: string | undefined
  if (body.customFields !== undefined) {
    try {
      customFieldsJson = await mergeCustomFields(existing.orgId, existing.customFieldsJson, body.customFields)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid customFields' }, { status: 400 })
    }
  }

  // Renaming the company a lead belongs to, or re-pointing it at a different
  // company entirely, both resolve through the same find-or-create helper
  // every other company entry point uses (app/api/leads/route.ts, bulk
  // import) — never a direct string write to the relation.
  let nextCompanyId: string | undefined
  if (body.company !== undefined) {
    const company = await findOrCreateCompany(existing.orgId, String(body.company))
    nextCompanyId = company.id
  }
  let nextPersonId: string | undefined | null
  if (body.poc !== undefined) {
    const pocName = body.poc ? String(body.poc).trim() : ''
    nextPersonId = pocName ? (await findOrCreatePerson(existing.orgId, nextCompanyId ?? existing.companyId!, pocName)).id : null
  }

  // Editing LinkedIn/other links on an already-linked contact — a direct
  // field update on the existing Person row, not a find-or-create (the
  // person already exists; this isn't re-resolving who they are, just
  // changing data on them, the same way editing their name would need a
  // different path than creating a new person).
  const personIdForLinks = nextPersonId !== undefined ? nextPersonId : existing.personId
  if (personIdForLinks && (body.linkedinUrl !== undefined || body.otherLinks !== undefined)) {
    await prisma.person.update({
      where: { id: personIdForLinks },
      data: {
        ...(body.linkedinUrl !== undefined && { linkedinUrl: body.linkedinUrl || null }),
        ...(body.otherLinks !== undefined && {
          otherLinksJson: JSON.stringify(Array.isArray(body.otherLinks) ? body.otherLinks.filter((l: unknown) => typeof l === 'string') : []),
        }),
      },
    })
  }

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      ...(customFieldsJson !== undefined && { customFieldsJson }),
      ...(nextPersonId !== undefined && { personId: nextPersonId }),
      ...(nextCompanyId !== undefined && { companyId: nextCompanyId }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.website !== undefined && { website: body.website }),
      ...(body.industry !== undefined && { industry: body.industry }),
      ...(body.businessType !== undefined && { businessType: body.businessType }),
      ...(body.painPoints !== undefined && { painPoints: body.painPoints }),
      ...(body.whatTheyWant !== undefined && { whatTheyWant: body.whatTheyWant }),
      ...(body.source !== undefined && { source: body.source }),
      ...(nextSubStage !== undefined && { onboardingSubStage: nextSubStage }),
      ...(nextOnboardedAt !== undefined && { onboardedAt: nextOnboardedAt }),
      ...(body.estimatedVolume !== undefined && { estimatedVolume: Number(body.estimatedVolume) }),
      // ownerName is not editable here: it must always match ownerId, which
      // only the admin bulk reassign (/api/leads/bulk) changes.
      ...(body.effort !== undefined && { effort: body.effort }),
      ...(body.quality !== undefined && { quality: body.quality }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.expectedCloseDate !== undefined && {
        expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
      }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.position !== undefined && { position: Number(body.position) }),
      ...(nextSubStage !== undefined && nextSubStage !== existing.onboardingSubStage && { lastActivityAt: new Date() }),
    },
    include: { company: true, person: true },
  })

  return NextResponse.json({ lead })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser()
  if (user instanceof NextResponse) return user
  const { id } = await params
  const existing = await prisma.lead.findFirst({ where: { id, ...leadScope(user) }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.lead.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}