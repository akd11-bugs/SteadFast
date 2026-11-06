import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import type { StageDefinition, OnboardingStepDefinition, PendingSubStatusDefinition } from '@prisma/client'
import {
  STAGES,
  STAGE_LABELS,
  STAGE_DESCRIPTIONS,
  ONBOARDING_SUB_STAGES,
  ONBOARDING_SUB_STAGE_LABELS,
  PENDING_SUB_STATUSES,
  PENDING_SUB_STATUS_LABELS,
} from '@/lib/types'

export { buildBoardColumns, type BoardColumn } from '@/lib/boardColumns'

// Seeds an org's StageDefinition rows from lib/types.ts's built-in STAGES the
// first time they're read, then returns the ordered list. All 5 seeded rows
// are `isCore: true` — their key/position are locked (enforced by the API
// route, not here) because lib/leadStage.ts, lib/alerts.ts, and
// lib/reportsData.ts branch on these literal string values; only
// label/description/color are meant to be admin-editable after seeding.
//
// A brand-new org's very first page load fires several of these
// concurrently (the page itself, usePipelineConfig's own fetch, anything
// else that reads stages) — each sees `existing.length === 0` before any of
// them has committed, so more than one tries to seed. Only one createMany
// wins; the rest hit the (orgId, key) unique constraint — re-fetch instead
// of treating that as a real failure.
export async function getStageDefinitions(orgId: string): Promise<StageDefinition[]> {
  const existing = await prisma.stageDefinition.findMany({ where: { orgId }, orderBy: { position: 'asc' } })
  if (existing.length > 0) return existing

  try {
    await prisma.stageDefinition.createMany({
      data: STAGES.map((key, position) => ({
        orgId,
        key,
        label: STAGE_LABELS[key],
        description: STAGE_DESCRIPTIONS[key],
        position,
        isCore: true,
      })),
    })
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
  }
  return prisma.stageDefinition.findMany({ where: { orgId }, orderBy: { position: 'asc' } })
}

// Same seed-on-first-read pattern for the onboarding sub-pipeline, and the
// same race guard. Only the *last* seeded row (today's literal
// 'final_onboarded') is `isCore: true` — it's the one lib/leadStage.ts
// checks to set onboardedAt, and the one lib/reportsData.ts's
// Activity-description convention `(<key>)` depends on. The 3 intermediate
// steps are fully admin add/remove/reorder/rename-able from the moment
// they're seeded.
export async function getOnboardingStepDefinitions(orgId: string): Promise<OnboardingStepDefinition[]> {
  const existing = await prisma.onboardingStepDefinition.findMany({ where: { orgId }, orderBy: { position: 'asc' } })
  if (existing.length > 0) return existing

  try {
    await prisma.onboardingStepDefinition.createMany({
      data: ONBOARDING_SUB_STAGES.map((key, position) => ({
        orgId,
        key,
        label: ONBOARDING_SUB_STAGE_LABELS[key],
        position,
        isCore: position === ONBOARDING_SUB_STAGES.length - 1,
      })),
    })
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
  }
  return prisma.onboardingStepDefinition.findMany({ where: { orgId }, orderBy: { position: 'asc' } })
}

// Same seed-on-first-read pattern, but no row is `isCore` here — unlike
// stages/onboarding-steps, every pending sub-status is fully admin
// add/remove/rename-able from the moment it's seeded (see
// PendingSubStatusDefinition's doc comment in prisma/schema.prisma for why).
// 'pending_ours' seeds as the default (isDefault: true) since it's the
// pre-existing hardcoded default this feature replaces — lib/leadStage.ts
// and the "Mark Contacted" quick actions assign whichever row has
// isDefault: true to a lead entering 'pending' with no explicit sub-status.
export async function getPendingSubStatusDefinitions(orgId: string): Promise<PendingSubStatusDefinition[]> {
  const existing = await prisma.pendingSubStatusDefinition.findMany({ where: { orgId }, orderBy: { position: 'asc' } })
  if (existing.length > 0) return existing

  try {
    await prisma.pendingSubStatusDefinition.createMany({
      data: PENDING_SUB_STATUSES.map((key, position) => ({
        orgId,
        key,
        label: PENDING_SUB_STATUS_LABELS[key],
        owner: key === 'pending_ours' ? 'us' : 'external',
        isDefault: key === 'pending_ours',
        position,
      })),
    })
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
  }
  return prisma.pendingSubStatusDefinition.findMany({ where: { orgId }, orderBy: { position: 'asc' } })
}
