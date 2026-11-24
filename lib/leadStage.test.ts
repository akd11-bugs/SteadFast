import { describe, expect, it, vi } from 'vitest'

const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'l1', ...data }))
vi.mock('@/lib/db', () => ({ prisma: { lead: { update: (a: never) => update(a) }, activity: { create: async () => ({}) } } }))
vi.mock('@/lib/workflow', () => ({ evaluateStageRules: async () => undefined }))
// The admin deleted 'document_submission'; 'kyc' is now first.
vi.mock('@/lib/pipelineConfig', () => ({
  getOnboardingStepDefinitions: async () => [{ key: 'kyc' }, { key: 'final_onboarded' }],
}))

const { applyStageChange } = await import('./leadStage')

describe('applyStageChange', () => {
  it("starts onboarding on the org's first step, not a hard-coded key", async () => {
    await applyStageChange(
      'l1',
      { orgId: 'org-a', stage: 'proposal', wonAt: null, onboardedAt: null, onboardingSubStage: null, pendingSubStatus: null },
      { stage: 'onboarding', remark: 'won' },
      { name: 'A' },
    )
    expect(update.mock.calls[0][0].data).toMatchObject({ onboardingSubStage: 'kyc', stage: 'onboarding' })
  })
})
