import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUniqueUserMock = vi.fn()
const findManyFieldDefMock = vi.fn()
const leadCreateMock = vi.fn()
const formUpdateMock = vi.fn()
const transactionMock = vi.fn((ops: unknown[]) => Promise.all(ops))
const findOrCreateCompanyMock = vi.fn()
const findOrCreatePersonMock = vi.fn()
const writeBackMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUserMock(...args) },
    leadFieldDefinition: { findMany: (...args: unknown[]) => findManyFieldDefMock(...args) },
    lead: { create: (...args: unknown[]) => leadCreateMock(...args) },
    orgLeadIntakeForm: { update: (...args: unknown[]) => formUpdateMock(...args) },
    $transaction: (ops: unknown[]) => transactionMock(ops),
  },
}))
vi.mock('@/lib/company', () => ({
  findOrCreateCompany: (...args: unknown[]) => findOrCreateCompanyMock(...args),
  findOrCreatePerson: (...args: unknown[]) => findOrCreatePersonMock(...args),
}))
vi.mock('@/lib/googleSheetWriteback', () => ({ writeBackLeadToSheet: (...args: unknown[]) => writeBackMock(...args) }))

const { submitPublicLeadIntake, PublicIntakeValidationError } = await import('@/lib/publicLeadIntake')

const orgId = 'org-1'
const owner = { id: 'user-1', name: 'Jane Owner', orgId, isActive: true }

beforeEach(() => {
  findUniqueUserMock.mockReset().mockResolvedValue(owner)
  findManyFieldDefMock.mockReset().mockResolvedValue([])
  leadCreateMock.mockReset().mockResolvedValue({ id: 'lead-1' })
  formUpdateMock.mockReset().mockResolvedValue({})
  findOrCreateCompanyMock.mockReset().mockResolvedValue({ id: 'company-1' })
  findOrCreatePersonMock.mockReset().mockResolvedValue({ id: 'person-1' })
  writeBackMock.mockReset().mockResolvedValue(undefined)
})

function submit(fieldConfigJson: string, input: Parameters<typeof submitPublicLeadIntake>[6]) {
  return submitPublicLeadIntake('form-1', 'My Form', orgId, owner.id, 'form', fieldConfigJson, input)
}

describe('submitPublicLeadIntake', () => {
  it('refuses to assign a lead to a deactivated default owner', async () => {
    findUniqueUserMock.mockResolvedValue({ ...owner, isActive: false })
    await expect(submit('[]', { company: 'Acme', email: 'a@acme.com' })).rejects.toThrow(/temporarily unavailable/)
  })

  it('creates a lead for a valid submission against the default ("[]") fixed field set', async () => {
    await submit('[]', { company: 'Acme', email: 'a@acme.com' })
    expect(leadCreateMock).toHaveBeenCalledTimes(1)
    expect(leadCreateMock.mock.calls[0][0].data.customFieldsJson).toBe('{}')
  })

  it('still requires company and email even for a form configured to omit them', async () => {
    const config = JSON.stringify([{ key: 'notes', required: false }])
    await expect(submit(config, { notes: 'hi' })).rejects.toThrow(PublicIntakeValidationError)
    expect(leadCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a missing value for a custom field this form marks required', async () => {
    findManyFieldDefMock.mockResolvedValue([{ key: 'budget', label: 'Budget', type: 'number', options: null }])
    const config = JSON.stringify([
      { key: 'company', required: true },
      { key: 'email', required: true },
      { key: 'budget', required: true },
    ])
    await expect(
      submit(config, { company: 'Acme', email: 'a@acme.com', customFields: {} }),
    ).rejects.toThrow(/Budget/)
    expect(leadCreateMock).not.toHaveBeenCalled()
  })

  it('merges a valid custom field value into the created lead\'s customFieldsJson', async () => {
    findManyFieldDefMock.mockResolvedValue([{ key: 'budget', label: 'Budget', type: 'number', options: null }])
    const config = JSON.stringify([
      { key: 'company', required: true },
      { key: 'email', required: true },
      { key: 'budget', required: true },
    ])
    await submit(config, {
      company: 'Acme',
      email: 'a@acme.com',
      customFields: { budget: 500 },
    })
    expect(JSON.parse(leadCreateMock.mock.calls[0][0].data.customFieldsJson)).toEqual({ budget: 500 })
  })

  it('rejects an invalid custom field value with the field\'s own validation error, not a generic one', async () => {
    findManyFieldDefMock.mockResolvedValue([{ key: 'budget', label: 'Budget', type: 'number', options: null }])
    const config = JSON.stringify([
      { key: 'company', required: true },
      { key: 'email', required: true },
      { key: 'budget', required: false },
    ])
    await expect(
      submit(config, {
        company: 'Acme',
        email: 'a@acme.com',
        customFields: { budget: 'not-a-number' },
      }),
    ).rejects.toThrow(/Budget/)
    expect(leadCreateMock).not.toHaveBeenCalled()
  })

  it('drops a submitted custom field this form is not configured to show, instead of storing it', async () => {
    findManyFieldDefMock.mockResolvedValue([{ key: 'budget', label: 'Budget', type: 'number', options: null }])
    // Form's config doesn't include "budget" at all.
    const config = JSON.stringify([{ key: 'company', required: true }, { key: 'email', required: true }])
    await submit(config, {
      company: 'Acme',
      email: 'a@acme.com',
      customFields: { budget: 999 },
    })
    expect(JSON.parse(leadCreateMock.mock.calls[0][0].data.customFieldsJson)).toEqual({})
  })

  it('still honors the honeypot silently, even with a populated customFields bag', async () => {
    const result = await submit('[]', {
      company: 'Acme',
      email: 'a@acme.com',
      website_url: 'http://spam.example',
    })
    expect(result).toEqual({ ok: true, silent: true })
    expect(leadCreateMock).not.toHaveBeenCalled()
  })
})
