import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRule } from '@prisma/client'
import type { LeadWithRelations as Lead } from '@/lib/leadStage'

const findManyMock = vi.fn()
const taskCreateMock = vi.fn()
const userFindUniqueMock = vi.fn()
const activityCreateMock = vi.fn()
const leadUpdateMock = vi.fn()
const sendEmailAsMock = vi.fn()
const tryDecryptMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    workflowRule: { findMany: (...args: unknown[]) => findManyMock(...args) },
    task: { create: (...args: unknown[]) => taskCreateMock(...args) },
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    activity: { create: (...args: unknown[]) => activityCreateMock(...args) },
    lead: { update: (...args: unknown[]) => leadUpdateMock(...args) },
  },
}))

vi.mock('@/lib/email', () => ({
  sendEmailAs: (...args: unknown[]) => sendEmailAsMock(...args),
}))

vi.mock('@/lib/crypto', () => ({
  tryDecrypt: (...args: unknown[]) => tryDecryptMock(...args),
}))

const { evaluateStageRules } = await import('@/lib/workflow')

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    ownerId: 'owner-1',
    email: 'lead@example.com',
    lastActivityAt: new Date('2026-01-01'),
    ...overrides,
  } as Lead
}

function makeRule(overrides: Partial<WorkflowRule> = {}): WorkflowRule {
  return {
    id: 'rule-1',
    ownerId: 'owner-1',
    name: 'Test rule',
    triggerType: 'stage_changed',
    triggerConfig: JSON.stringify({ toStage: 'qualified' }),
    actionType: 'create_task',
    actionConfig: JSON.stringify({ title: 'Follow up' }),
    active: true,
    ...overrides,
  } as WorkflowRule
}

beforeEach(() => {
  vi.useRealTimers()
  findManyMock.mockReset()
  taskCreateMock.mockReset()
  userFindUniqueMock.mockReset()
  activityCreateMock.mockReset()
  leadUpdateMock.mockReset()
  sendEmailAsMock.mockReset()
  tryDecryptMock.mockReset()
  activityCreateMock.mockResolvedValue({ date: new Date('2026-02-02') })
  tryDecryptMock.mockReturnValue('plain-signing-secret')
  vi.stubGlobal('fetch', vi.fn())
})

describe('evaluateStageRules', () => {
  it('does nothing when no rules match the owner/trigger type', async () => {
    findManyMock.mockResolvedValue([])
    await evaluateStageRules(makeLead(), 'qualified')
    expect(taskCreateMock).not.toHaveBeenCalled()
    expect(sendEmailAsMock).not.toHaveBeenCalled()
  })

  it('skips a rule whose configured toStage does not match the new stage', async () => {
    findManyMock.mockResolvedValue([makeRule({ triggerConfig: JSON.stringify({ toStage: 'proposal' }) })])
    await evaluateStageRules(makeLead(), 'qualified')
    expect(taskCreateMock).not.toHaveBeenCalled()
  })

  it('silently ignores malformed JSON in triggerConfig instead of throwing', async () => {
    findManyMock.mockResolvedValue([makeRule({ triggerConfig: '{not json' })])
    await expect(evaluateStageRules(makeLead(), 'qualified')).resolves.toBeUndefined()
    expect(taskCreateMock).not.toHaveBeenCalled()
  })

  it('runs every matching rule, not just the first', async () => {
    findManyMock.mockResolvedValue([
      makeRule({ id: 'r1', actionConfig: JSON.stringify({ title: 'Task A' }) }),
      makeRule({ id: 'r2', actionConfig: JSON.stringify({ title: 'Task B' }) }),
    ])
    await evaluateStageRules(makeLead(), 'qualified')
    expect(taskCreateMock).toHaveBeenCalledTimes(2)
  })

  describe('create_task action', () => {
    it('creates a task with no due date when dueInDays is omitted', async () => {
      findManyMock.mockResolvedValue([makeRule({ actionConfig: JSON.stringify({ title: 'Call back' }) })])
      await evaluateStageRules(makeLead(), 'qualified')
      expect(taskCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({ leadId: 'lead-1', title: 'Call back', dueDate: null, source: 'sequence', ownerId: 'owner-1' }),
      })
    })

    it('computes dueDate as now + dueInDays', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
      findManyMock.mockResolvedValue([makeRule({ actionConfig: JSON.stringify({ title: 'Follow up', dueInDays: 3 }) })])
      await evaluateStageRules(makeLead(), 'qualified')
      const call = taskCreateMock.mock.calls[0][0]
      expect(call.data.dueDate.toISOString()).toBe('2026-03-04T00:00:00.000Z')
      vi.useRealTimers()
    })

    it('skips creating a task when actionConfig has no title', async () => {
      findManyMock.mockResolvedValue([makeRule({ actionConfig: JSON.stringify({}) })])
      await evaluateStageRules(makeLead(), 'qualified')
      expect(taskCreateMock).not.toHaveBeenCalled()
    })
  })

  describe('send_email action', () => {
    function emailRule(overrides: Partial<WorkflowRule> = {}) {
      return makeRule({
        actionType: 'send_email',
        actionConfig: JSON.stringify({ subject: 'Hi', body: 'Body text' }),
        ...overrides,
      })
    }

    it('sends to the lead email by default, logs the activity, and updates lastActivityAt', async () => {
      findManyMock.mockResolvedValue([emailRule()])
      sendEmailAsMock.mockResolvedValue({ id: 'msg-1' })
      const lead = makeLead({ email: 'lead@example.com' })
      await evaluateStageRules(lead, 'qualified')

      expect(sendEmailAsMock).toHaveBeenCalledWith('owner-1', { to: 'lead@example.com', subject: 'Hi', body: 'Body text' })
      expect(activityCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leadId: 'lead-1',
          type: 'email',
          description: expect.stringContaining('Sent: "Hi"'),
        }),
      })
      expect(leadUpdateMock).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { lastActivityAt: new Date('2026-02-02') } })
    })

    it('skips silently when the lead has no email and "to" is not set to owner', async () => {
      findManyMock.mockResolvedValue([emailRule()])
      await evaluateStageRules(makeLead({ email: '' }), 'qualified')
      expect(sendEmailAsMock).not.toHaveBeenCalled()
      expect(activityCreateMock).not.toHaveBeenCalled()
    })

    it('sends to the rule owner\'s email when to="owner", using an "Automation —" prefix and "Notified owner:" description', async () => {
      findManyMock.mockResolvedValue([emailRule({ actionConfig: JSON.stringify({ subject: 'Heads up', body: 'Moved stage', to: 'owner' }) })])
      userFindUniqueMock.mockResolvedValue({ email: 'owner@example.com' })
      sendEmailAsMock.mockResolvedValue({ id: 'msg-2' })
      await evaluateStageRules(makeLead(), 'qualified')

      expect(userFindUniqueMock).toHaveBeenCalledWith({ where: { id: 'owner-1' }, select: { email: true } })
      expect(sendEmailAsMock).toHaveBeenCalledWith('owner-1', { to: 'owner@example.com', subject: 'Heads up', body: 'Moved stage' })
      expect(activityCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({ description: expect.stringContaining('Notified owner: "Heads up"') }),
      })
    })

    it('skips when to="owner" but the owner user has no email on file', async () => {
      findManyMock.mockResolvedValue([emailRule({ actionConfig: JSON.stringify({ subject: 'Heads up', body: 'Moved stage', to: 'owner' }) })])
      userFindUniqueMock.mockResolvedValue({ email: null })
      await evaluateStageRules(makeLead(), 'qualified')
      expect(sendEmailAsMock).not.toHaveBeenCalled()
    })

    it('skips when actionConfig is missing subject or body', async () => {
      findManyMock.mockResolvedValue([emailRule({ actionConfig: JSON.stringify({ subject: 'Only subject' }) })])
      await evaluateStageRules(makeLead(), 'qualified')
      expect(sendEmailAsMock).not.toHaveBeenCalled()
    })

    it('records a failed send as a visible "failed" note, never as "Sent", and keeps running the other rules', async () => {
      findManyMock.mockResolvedValue([emailRule(), emailRule({ id: 'rule-2' })])
      sendEmailAsMock.mockRejectedValueOnce(new Error('SMTP auth failed')).mockResolvedValueOnce({ id: 'm-2' })
      await expect(evaluateStageRules(makeLead(), 'qualified')).resolves.toBeUndefined()
      expect(sendEmailAsMock).toHaveBeenCalledTimes(2)
      const descriptions = activityCreateMock.mock.calls.map((c) => (c[0] as { data: { type: string; description: string } }).data)
      expect(descriptions[0]).toMatchObject({ type: 'note', description: expect.stringContaining('SMTP auth failed') })
      expect(descriptions[1]).toMatchObject({ type: 'email', description: expect.stringContaining('Sent:') })
    })
  })

  describe('call_webhook action', () => {
    function webhookRule(overrides: Partial<WorkflowRule> = {}) {
      return makeRule({
        actionType: 'call_webhook',
        actionConfig: JSON.stringify({ url: 'https://example.com/hook', signingSecretEnc: 'encrypted-secret' }),
        ...overrides,
      })
    }

    it('POSTs a signed payload, logs the activity, and updates lastActivityAt on a 2xx response', async () => {
      findManyMock.mockResolvedValue([webhookRule()])
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 })

      const lead = makeLead({ company: { id: 'company-1', name: 'Acme' } as Lead['company'], stage: 'qualified' })
      await evaluateStageRules(lead, 'qualified')

      expect(fetch).toHaveBeenCalledTimes(1)
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(url).toBe('https://example.com/hook')
      expect(init.method).toBe('POST')
      expect(init.headers['x-webhook-signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
      const payload = JSON.parse(init.body)
      expect(payload).toMatchObject({ event: 'lead.stage_changed', lead: { id: 'lead-1', company: 'Acme', stage: 'qualified' } }) // payload still flattens to company's name string — see lib/workflow.ts

      expect(activityCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({ leadId: 'lead-1', type: 'note', description: expect.stringContaining('example.com') }),
      })
      expect(leadUpdateMock).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { lastActivityAt: new Date('2026-02-02') } })
    })

    it('does not propagate and does not log an activity when the endpoint returns a non-2xx status', async () => {
      findManyMock.mockResolvedValue([webhookRule()])
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 })

      await expect(evaluateStageRules(makeLead(), 'qualified')).resolves.toBeUndefined()
      expect(activityCreateMock).not.toHaveBeenCalled()
      expect(leadUpdateMock).not.toHaveBeenCalled()
    })

    it('does not propagate when the fetch itself throws (endpoint down/unreachable)', async () => {
      findManyMock.mockResolvedValue([webhookRule()])
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(evaluateStageRules(makeLead(), 'qualified')).resolves.toBeUndefined()
      expect(activityCreateMock).not.toHaveBeenCalled()
    })

    it('skips without calling fetch when actionConfig is missing url or signingSecretEnc', async () => {
      findManyMock.mockResolvedValue([webhookRule({ actionConfig: JSON.stringify({ url: 'https://example.com/hook' }) })])
      await evaluateStageRules(makeLead(), 'qualified')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('skips without throwing when the signing secret fails to decrypt (key rotated)', async () => {
      tryDecryptMock.mockReturnValue(null)
      findManyMock.mockResolvedValue([webhookRule()])
      await expect(evaluateStageRules(makeLead(), 'qualified')).resolves.toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})
